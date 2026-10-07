export * as MapsGooglePage from "./google-page.js"

import { NetGuard } from "../net-guard.js"
import { ScrapeChromium } from "../scrape/chromium.js"
import type { Geo } from "./geo.js"
import { MapsOsm } from "./osm.js"

// fork: most employers on the job boards are not in OSM by name, but Google Maps knows their office. The public search
// page is rendered in the headless browser (no API key) and read like a person reads it: the place links carry the
// coordinates ("!3d<lat>!4d<lng>"), a single match opens the place page. A consent page or captcha ends the attempt
// quietly; it is never worked around. One page at a time with a pause between, answers cached for a week.

export type Hit = { readonly name: string; readonly latitude: number; readonly longitude: number; readonly address?: string; readonly url: string }
export type Answer = { readonly hits: readonly Hit[]; readonly blocked?: boolean; readonly error?: string }

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const queue = { chain: Promise.resolve() as Promise<unknown>, last: 0, blockedUntil: 0 }

/**
 * The place coordinates in a Google Maps link: "!3d<lat>!4d<lng>" (the place itself) first; "@lat,lng" only on a place
 * page, because on a search page it is the map's viewport centre, not a place.
 */
export function coordinates(url: string): Geo.Point | undefined {
  const text = decode(url)
  const data = [...text.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].at(-1)
  const at = /\/maps\/place\//.test(text) ? text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$|\/)/) : null
  const match = data ?? at
  if (!match) return undefined
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  return { latitude, longitude }
}

/** True when Google answered with a consent page, a "sorry" (unusual traffic) page or a captcha instead of the map. */
export function blocked(html: string, finalUrl: string) {
  const host = URL.canParse(finalUrl) ? new URL(finalUrl).hostname : ""
  return (
    /^consent\./.test(host) ||
    /\/sorry\//.test(finalUrl) ||
    /unusual traffic|recaptcha|g-recaptcha|captcha-form|before you continue to google|sebelum anda melanjutkan ke google/i.test(html.slice(0, 200_000))
  )
}

/** The places on a rendered Google Maps page: the place page itself, or the result list's links. */
export function parse(html: string, finalUrl: string): Answer {
  if (blocked(html, finalUrl)) return { hits: [], blocked: true }
  if (/\/maps\/place\//.test(finalUrl)) {
    const point = coordinates(finalUrl)
    const name =
      attribute(html.match(/<h1\b[^>]*>([\s\S]{0,300}?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, "")) ||
      decode(finalUrl.match(/\/maps\/place\/([^/]+)/)?.[1] ?? "").replace(/\+/g, " ")
    const address = attribute(html.match(/<[^>]*data-item-id="address"[^>]*>/)?.[0]?.match(/aria-label="([^"]*)"/)?.[1])?.replace(/^(alamat|address):\s*/i, "")
    return point && name ? { hits: [{ name, ...point, ...(address ? { address } : {}), url: finalUrl }] } : { hits: [] }
  }
  const links = [...html.matchAll(/<a\b[^>]*href="(https:\/\/www\.google\.com\/maps\/place\/[^"]+)"[^>]*>/g)]
  const hits = links.flatMap((match, index): Hit[] => {
    const tag = match[0]
    const url = attribute(match[1])!
    const point = coordinates(url)
    const name = attribute(tag.match(/aria-label="([^"]*)"/)?.[1])
    if (!point || !name) return []
    // The card text after the link: category · address, split by "·".
    const end = links[index + 1]?.index ?? match.index! + 6000
    const text = attribute(html.slice(match.index! + tag.length, Math.min(end, match.index! + 6000)).replace(/<[^>]+>/g, " | "))
    const address = text
      ?.split(/\s*[|·]\s*/)
      .map((part) => part.trim())
      .find((part) => /^(jl\.?|jln\.?|jalan|gedung|gd\.|menara|wisma|graha|ruko|komplek|kompleks|kawasan|plaza)\s/i.test(part))
    return [{ name, ...point, ...(address ? { address } : {}), url }]
  })
  return { hits: hits.filter((hit, index) => hits.findIndex((other) => other.url === hit.url) === index) }
}

/** The Google Maps search page for a text, read in the headless browser. Never throws. */
export async function search(query: string): Promise<Answer> {
  const key = query.trim().toLowerCase().replace(/\s+/g, " ")
  const cached = await MapsOsm.cache.get<Answer>("gmaps-page", key, CACHE_TTL)
  if (cached?.fresh) return cached.value
  if (process.env.OPENCODE_MAPS_GOOGLE_PAGE === "0") return { hits: [], error: "disabled" }
  if (!ScrapeChromium.available()) return { hits: [], error: "no browser" }
  if (Date.now() < queue.blockedUntil) return { hits: [], blocked: true }
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=id`
  const run = queue.chain.then(async (): Promise<Answer> => {
    if (Date.now() < queue.blockedUntil) return { hits: [], blocked: true }
    const wait = queue.last + Number(process.env.OPENCODE_MAPS_GOOGLE_PAGE_INTERVAL_MS ?? 1500) - Date.now()
    if (wait > 0) await Bun.sleep(wait)
    try {
      const page = await ScrapeChromium.render(url, { timeoutMs: 30_000, waitMs: 3500 })
      if (!(await NetGuard.assertPublicUrl(page.finalUrl).then(() => true, () => false))) return { hits: [], error: "redirected to a private address" }
      const answer = parse(page.html, page.finalUrl)
      // Google asked for consent or a captcha: stop asking for a while instead of retrying.
      if (answer.blocked) queue.blockedUntil = Date.now() + 30 * 60 * 1000
      else MapsOsm.cache.set("gmaps-page", key, answer)
      return answer
    } catch (error) {
      return { hits: [], error: error instanceof Error ? error.message : String(error) }
    } finally {
      queue.last = Date.now()
    }
  })
  queue.chain = run.catch(() => undefined)
  return run
}

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function attribute(value: string | undefined) {
  if (value === undefined) return undefined
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}
