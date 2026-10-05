import { ForbiddenError, InvalidRequestError } from "@opencode/protocol/errors"
import {
  BROWSER_PROXY_TICKET_QUERY,
  BROWSER_PROXY_TOKEN_HEADER,
  BROWSER_PROXY_TOKEN_HEADER_VALUE,
} from "@opencode/protocol/groups/browser-proxy"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"

// fork: server side of the web Browser pane (ported from the v1 fork). A browser tab cannot host a
// native web view, so pages are fetched here, stripped of framing restrictions, and framed by the app.
// This fetches caller-supplied URLs, so every hop is checked against private and loopback targets.

const TICKET_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5
// Proxied pages are served from this server's origin, so they must never run with it: the CSP sandbox
// gives them an opaque origin even when opened outside the pane's sandboxed iframe (a tab or popup).
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

// Single-use, URL-scoped tickets: the iframe src cannot carry credentials, and embedding the password
// would expose it to the framed page's own scripts.
const tickets = new Map<string, { url: string; expires: number }>()

export const BrowserProxyHandler = HttpApiBuilder.group(Api, "server.browserProxy", (handlers) =>
  Effect.gen(function* () {
    const cors = yield* CorsConfig

    return handlers
      .handle(
        "browserProxy.ticket",
        Effect.fn("BrowserProxyHandler.ticket")(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // The custom header forces a CORS preflight, so cross-origin pages cannot mint tickets.
          if (
            request.headers[BROWSER_PROXY_TOKEN_HEADER] !== BROWSER_PROXY_TOKEN_HEADER_VALUE ||
            !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
          )
            return yield* new ForbiddenError({ message: "Invalid browser proxy ticket request" })
          const target = yield* Effect.promise(() => validateTarget(ctx.payload.url))
          if (!target.ok) return yield* new InvalidRequestError({ message: target.reason, kind: "browser_proxy_target" })
          return { ticket: issueTicket(ctx.payload.url), expiresIn: TICKET_TTL_MS / 1000 }
        }),
      )
      .handle(
        "browserProxy.preview",
        Effect.fn("BrowserProxyHandler.preview")(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          if (
            request.headers[BROWSER_PROXY_TOKEN_HEADER] !== BROWSER_PROXY_TOKEN_HEADER_VALUE ||
            !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
          )
            return yield* new ForbiddenError({ message: "Invalid preview request" })
          if (ctx.payload.html.length > MAX_PREVIEW_CHARS)
            return yield* new InvalidRequestError({ message: "Preview is too large", kind: "html_preview_size" })
          return { ticket: stagePreview(ctx.payload.html), expiresIn: PREVIEW_TTL_MS / 1000 }
        }),
      )
      .handleRaw(
        "browserProxy.previewPage",
        Effect.fn("BrowserProxyHandler.previewPage")(function* (ctx) {
          const ticket = new URL(ctx.request.url, "http://localhost").searchParams.get(BROWSER_PROXY_TICKET_QUERY)
          const html = ticket ? readPreview(ticket) : undefined
          if (html === undefined) return HttpServerResponse.empty({ status: 404 })
          // The page runs scripts but as an opaque origin: never with this server's cookies, storage or API.
          return HttpServerResponse.text(html, {
            contentType: "text/html; charset=utf-8",
            headers: {
              "content-security-policy": PREVIEW_SANDBOX,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          })
        }),
      )
      .handleRaw(
        "browserProxy.proxy",
        Effect.fn("BrowserProxyHandler.proxy")(function* (ctx) {
          const url = new URL(ctx.request.url, "http://localhost")
          const target = url.searchParams.get("url")
          if (!target) return HttpServerResponse.empty({ status: 400 })
          const ticket = url.searchParams.get(BROWSER_PROXY_TICKET_QUERY)
          // Always ticketed: a server without a password would otherwise be an open proxy any site could use.
          if (!ticket || !consume(ticket, target)) return HttpServerResponse.empty({ status: 403 })
          return HttpServerResponse.fromWeb(yield* Effect.promise(() => proxyPage(target)))
        }),
      )
  }),
)

// fork: staged HTML previews. Unguessable ids with a short life; the content is the user's own file.
const PREVIEW_TTL_MS = 10 * 60_000
const MAX_PREVIEW_CHARS = 12 * 1024 * 1024
const MAX_PREVIEWS = 40
const PREVIEW_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
const previews = new Map<string, { html: string; expires: number }>()

export function stagePreview(html: string, now = Date.now()) {
  previews.forEach((value, key) => value.expires < now && previews.delete(key))
  // Oldest first (Map keeps insertion order) once the cap is reached.
  while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value!)
  const id = crypto.randomUUID()
  previews.set(id, { html, expires: now + PREVIEW_TTL_MS })
  return id
}

export function readPreview(id: string, now = Date.now()) {
  const record = previews.get(id)
  if (!record || record.expires < now) {
    previews.delete(id)
    return undefined
  }
  return record.html
}

export function issueTicket(url: string, now = Date.now()) {
  tickets.forEach((value, key) => value.expires < now && tickets.delete(key))
  const ticket = crypto.randomUUID()
  tickets.set(ticket, { url, expires: now + TICKET_TTL_MS })
  return ticket
}

export function consume(ticket: string, url: string, now = Date.now()) {
  const record = tickets.get(ticket)
  tickets.delete(ticket)
  return !!record && record.url === url && record.expires >= now
}

export async function proxyPage(raw: string) {
  const response = await fetchTarget(raw)
  response.headers.append("content-security-policy", SANDBOX)
  return response
}

// DNS can still change between this check and the fetch: the check stops direct and redirected private
// targets, not DNS rebinding.
async function fetchTarget(raw: string): Promise<Response> {
  const hops = Array.from({ length: MAX_REDIRECTS + 1 })
  const state = { url: raw }
  for (const _ of hops) {
    const target = await validateTarget(state.url)
    if (!target.ok) return new Response(target.reason, { status: 400 })
    const response = await fetch(target.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    }).catch(() => undefined)
    if (!response) return new Response("Upstream request failed", { status: 502 })
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      state.url = new URL(location, target.url).toString()
      continue
    }
    return rewrite(response, target.url.toString())
  }
  return new Response("Too many redirects", { status: 508 })
}

export async function rewrite(response: Response, url: string) {
  const headers = new Headers(response.headers)
  ;["content-encoding", "content-length", "transfer-encoding", "x-frame-options", "set-cookie"].forEach((name) =>
    headers.delete(name),
  )
  ;["content-security-policy", "content-security-policy-report-only"].forEach((name) => {
    const value = headers.get(name)
    if (!value) return
    // Only the framing directive goes; the site's own script and style policy still protects it.
    const kept = value
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive && !/^frame-ancestors\b/i.test(directive))
      .join("; ")
    if (kept) headers.set(name, kept)
    else headers.delete(name)
  })
  const type = headers.get("content-type") ?? ""
  if (!type.startsWith("text/html")) return new Response(capped(response.body), { status: response.status, headers })
  const bytes = await new Response(capped(response.body)).arrayBuffer()
  // The page is re-encoded as UTF-8 after injection, so decode it with the charset it was sent in.
  headers.set("content-type", "text/html; charset=utf-8")
  return new Response(injectBridge(decode(bytes, type), url), { status: response.status, headers })
}

function decode(bytes: ArrayBuffer, type: string) {
  const charset = type.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8"
  const decoder = (() => {
    try {
      return new TextDecoder(charset)
    } catch {
      return new TextDecoder()
    }
  })()
  return decoder.decode(bytes)
}

function capped(body: ReadableStream<Uint8Array> | null) {
  if (!body) return null
  const state = { total: 0 }
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        state.total += chunk.byteLength
        if (state.total > MAX_RESPONSE_BYTES) return controller.terminate()
        controller.enqueue(chunk)
      },
    }),
  )
}

// <base> keeps relative assets pointing at the real site. The bridge reports selections, the page
// title, and link or GET-form navigation to the app, which re-enters the proxy with a fresh ticket.
export function injectBridge(html: string, url: string) {
  const inject = `<base href="${url.replace(/"/g, "&quot;")}"><script>${BRIDGE}</script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}${inject}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${inject}</head>`)
  return `<head>${inject}</head>${html}`
}

const BRIDGE = `(function(){
var post=function(m){try{window.parent.postMessage(m,"*")}catch(e){}};
var page=function(){post({opencodeBrowserPage:{title:document.title||"",url:document.baseURI}})};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",page);else page();
var t;document.addEventListener("selectionchange",function(){clearTimeout(t);t=setTimeout(function(){
var s=document.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;var text=s.toString();if(!text.trim())return;
var r=s.getRangeAt(0).getBoundingClientRect();
post({opencodeBrowserSelection:{text:text.slice(0,4000),rect:{x:r.left,y:r.top,width:r.width,height:r.height}}})},150)});
document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.href;if(!/^https?:/i.test(h))return;
if(h.split("#")[0]===document.baseURI.split("#")[0]&&h.indexOf("#")>=0)return;
e.preventDefault();post({opencodeBrowserNavigate:{url:h,external:a.target==="_blank"}})},true);
document.addEventListener("submit",function(e){var f=e.target;if(!f||(f.method||"get").toLowerCase()!=="get")return;
try{var u=new URL(f.action||document.baseURI);new FormData(f).forEach(function(v,k){if(typeof v==="string")u.searchParams.append(k,v)});
e.preventDefault();post({opencodeBrowserNavigate:{url:u.toString()}})}catch(x){}},true);
})();`

type Target = { ok: true; url: URL } | { ok: false; reason: string }

export async function validateTarget(raw: string): Promise<Target> {
  const url = URL.canParse(raw) ? new URL(raw) : undefined
  if (!url) return { ok: false, reason: "Invalid URL" }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http(s) pages can open" }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(host) ? [host] : await resolve(host)
  if (!addresses.length) return { ok: false, reason: "Could not resolve host" }
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: "Private and local addresses cannot be opened" }
  return { ok: true, url }
}

async function resolve(host: string) {
  const { lookup } = await import("node:dns/promises")
  return lookup(host, { all: true })
    .then((entries) => entries.map((entry) => entry.address))
    .catch(() => [])
}

function isIP(value: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":")
}

export function isPrivateAddress(address: string) {
  return address.includes(":") ? isPrivateV6(address.toLowerCase()) : isPrivateV4(address)
}

function isPrivateV4(value: string) {
  const parts = value.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = 0, b = 0, c = 0] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return a >= 224
}

// URL parsing rewrites embedded IPv4 as hex (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`), so
// addresses are compared as 16-bit groups rather than by prefix. Anything unparseable counts as private.
function isPrivateV6(value: string) {
  const groups = hextets(value)
  if (!groups) return true
  const [first = 0, second = 0, third = 0, , , sixth = 0, seventh = 0, eighth = 0] = groups
  const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  const zero = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0)
  // ::, ::1, and the deprecated IPv4-compatible ::a.b.c.d
  if (zero(0, 6)) return true
  // IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d reach the embedded IPv4 address.
  if (zero(0, 5) && sixth === 0xffff) return isPrivateV4(v4(seventh, eighth))
  if (first === 0x64 && second === 0xff9b && zero(2, 6)) return isPrivateV4(v4(seventh, eighth))
  // 6to4 2002:aabb:ccdd::
  if (first === 0x2002) return isPrivateV4(v4(second, third))
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true
  return (first & 0xff00) === 0xff00
}

function hextets(value: string) {
  const dotted = value.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  const octets = dotted?.slice(2).map(Number)
  if (octets?.some((octet) => octet > 255)) return
  const text =
    dotted && octets
      ? `${dotted[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
      : value
  const halves = text.split("::")
  if (halves.length > 2) return
  const parse = (part: string) =>
    part ? part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN)) : []
  const head = parse(halves[0]!)
  const tail = halves.length === 2 ? parse(halves[1]!) : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return
  const groups = [...head, ...Array.from({ length: fill }, () => 0), ...tail]
  if (groups.some((group) => Number.isNaN(group))) return
  return groups
}
