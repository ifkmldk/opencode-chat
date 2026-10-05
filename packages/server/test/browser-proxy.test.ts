import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { it } from "../../core/test/lib/effect"
import {
  consume,
  injectBridge,
  isPrivateAddress,
  issueTicket,
  proxyPage,
  readPreview,
  rewrite,
  stagePreview,
  validateTarget,
} from "../src/handlers/browser-proxy"
import { ServerProcess } from "../src/process"

const PROXY = "/api/experimental/browser-proxy"

test("private, loopback, and special-use addresses are blocked", () => {
  const blocked = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.0.170",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::7f00:1",
    "64:ff9b::a00:1",
    "2002:c0a8:101::1",
    "1:2:3",
    "fe80::1%eth0",
    "300.1.1.1",
  ]
  expect(blocked.filter((address) => !isPrivateAddress(address))).toEqual([])
})

test("public addresses are allowed", () => {
  const allowed = ["93.184.215.14", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:5db8:d70e"]
  expect(allowed.filter((address) => isPrivateAddress(address))).toEqual([])
  expect(isPrivateAddress("2002:5db8:d70e::1")).toBe(false)
  expect(isPrivateAddress("64:ff9b::808:808")).toBe(false)
})

test("targets must be public http(s) URLs, including after URL normalisation", async () => {
  const rejected = [
    "ftp://example.com/",
    "javascript:alert(1)",
    "not a url",
    "http://127.0.0.1:4096/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://localhost:4096/",
    "http://169.254.169.254/latest/meta-data/",
  ]
  const results = await Promise.all(rejected.map(async (url) => [url, (await validateTarget(url)).ok] as const))
  expect(results.filter(([, ok]) => ok)).toEqual([])
  expect((await validateTarget("https://93.184.215.14/")).ok).toBe(true)
})

test("tickets are single-use, bound to one URL, and expire", () => {
  const url = "https://example.com/"
  const wrong = issueTicket(url, 1_000)
  expect(consume(wrong, "https://example.com/other", 1_000)).toBe(false)
  expect(consume(wrong, url, 1_000)).toBe(false)
  const ticket = issueTicket(url, 1_000)
  expect(consume(ticket, url, 1_000)).toBe(true)
  expect(consume(ticket, url, 1_000)).toBe(false)
  const stale = issueTicket(url, 1_000)
  expect(consume(stale, url, 1_000 + 60_001)).toBe(false)
})

test("pages lose framing restrictions but keep their own content policy", async () => {
  const response = await rewrite(
    new Response("<html><head><title>x</title></head><body>hi</body></html>", {
      headers: {
        "content-type": "text/html",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'; script-src 'self'",
        "set-cookie": "a=b",
      },
    }),
    "https://example.com/a",
  )
  expect(response.headers.get("x-frame-options")).toBeNull()
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(response.headers.get("content-security-policy")).toBe("script-src 'self'")
  expect(await response.text()).toContain('<head><base href="https://example.com/a"><script>')
})

test("pages in other charsets are re-encoded as UTF-8", async () => {
  const encode = (text: string) => new TextEncoder().encode(text)
  const body = new Uint8Array([...encode("<p>caf"), 0xe9, ...encode("</p>")])
  const response = await rewrite(
    new Response(body, { headers: { "content-type": "text/html; charset=windows-1252" } }),
    "https://example.com/",
  )
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(await response.text()).toContain("<p>café</p>")
})

test("the bridge is injected into documents without a head", () => {
  expect(injectBridge("<p>hi</p>", "https://example.com/")).toStartWith('<head><base href="https://example.com/">')
  expect(injectBridge("<html><p>hi</p></html>", "https://example.com/")).toStartWith(
    '<html><head><base href="https://example.com/">',
  )
})

test("proxied responses always run in a sandboxed origin", async () => {
  const response = await proxyPage("http://127.0.0.1/")
  expect(response.status).toBe(400)
  expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts")
})

const authorization = `Basic ${btoa("opencode:secret")}`
const start = () =>
  ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
  })

it.live("the proxy only serves ticketed requests, even with credentials", () =>
  Effect.gen(function* () {
    const server = yield* start()
    const base = HttpServer.formatAddress(server.address)
    const url = encodeURIComponent("https://93.184.215.14/")
    const anonymous = yield* Effect.promise(() => fetch(new URL(`${PROXY}?url=${url}`, base)))
    expect(anonymous.status).toBe(401)
    const credentialed = yield* Effect.promise(() =>
      fetch(new URL(`${PROXY}?url=${url}`, base), { headers: { authorization } }),
    )
    expect(credentialed.status).toBe(403)
    const bogus = yield* Effect.promise(() => fetch(new URL(`${PROXY}?url=${url}&ticket=bogus`, base)))
    expect(bogus.status).toBe(403)
  }),
)

it.live("tickets need credentials and the app header, and only cover their own URL", () =>
  Effect.gen(function* () {
    const server = yield* start()
    const base = HttpServer.formatAddress(server.address)
    const mint = (headers: Record<string, string>, url: string) =>
      Effect.promise(() =>
        fetch(new URL(`${PROXY}/ticket`, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ url }),
        }),
      )

    expect((yield* mint({ "x-opencode-ticket": "1" }, "https://93.184.215.14/")).status).toBe(401)
    expect((yield* mint({ authorization }, "https://93.184.215.14/")).status).toBe(403)
    expect((yield* mint({ authorization, "x-opencode-ticket": "1" }, "http://127.0.0.1:4096/")).status).toBe(400)

    const minted = yield* mint({ authorization, "x-opencode-ticket": "1" }, "https://93.184.215.14/")
    expect(minted.status).toBe(200)
    const { ticket } = (yield* Effect.promise(() => minted.json())) as { ticket: string }
    const other = encodeURIComponent("https://93.184.215.14/other")
    const reused = yield* Effect.promise(() => fetch(new URL(`${PROXY}?url=${other}&ticket=${ticket}`, base)))
    expect(reused.status).toBe(403)
  }),
)

// fork: staged HTML previews.
test("staged previews expire and are capped", () => {
  const id = stagePreview("<p>a</p>", 1_000)
  expect(readPreview(id, 1_001)).toBe("<p>a</p>")
  expect(readPreview(id, 1_000 + 10 * 60_000 + 1)).toBeUndefined()
  const first = stagePreview("first", 2_000)
  Array.from({ length: 45 }, (_, index) => stagePreview(`n${index}`, 2_001))
  expect(readPreview(first, 2_002)).toBeUndefined()
})

it.live("previews: minting needs credentials and the app header; the page is framed by ticket with only a sandbox", () =>
  Effect.gen(function* () {
    const server = yield* start()
    const base = HttpServer.formatAddress(server.address)
    const mint = (headers: Record<string, string>) =>
      Effect.promise(() =>
        fetch(new URL(`${PROXY}/preview`, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ html: "<h1>hi</h1><script>window.x=1</script>" }),
        }),
      )
    expect((yield* mint({ "x-opencode-ticket": "1" })).status).toBe(401)
    expect((yield* mint({ authorization })).status).toBe(403)
    const minted = yield* mint({ authorization, "x-opencode-ticket": "1" })
    expect(minted.status).toBe(200)
    const { ticket } = (yield* Effect.promise(() => minted.json())) as { ticket: string }
    // The iframe sends no credentials: the ticket alone opens the page.
    const page = yield* Effect.promise(() => fetch(new URL(`${PROXY}/preview?ticket=${ticket}`, base)))
    expect(page.status).toBe(200)
    expect(yield* Effect.promise(() => page.text())).toContain("window.x=1")
    expect(page.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
    )
    expect((yield* Effect.promise(() => fetch(new URL(`${PROXY}/preview?ticket=bogus`, base)))).status).toBe(404)
    expect((yield* Effect.promise(() => fetch(new URL(`${PROXY}/preview`, base)))).status).toBe(401)
  }),
)
