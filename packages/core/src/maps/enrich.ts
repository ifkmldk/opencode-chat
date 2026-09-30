export * as MapsEnrich from "./enrich.js"

// fork: free place details for OpenStreetMap results, so cards can show more than a name. Facts come from the
// place's OSM tags (opening hours, hotel stars, phone, website, cuisine); photos come from Wikimedia Commons,
// Wikipedia or Wikidata when the OSM object links one. Everything is keyless and never billed.

const userAgent = "OpenCode/2 maps tools (+https://opencode.ai)"
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const

export type Details = {
  openingHours?: string
  openNow?: boolean
  hoursToday?: string
  stars?: number
  phone?: string
  website?: string
  cuisine?: string
}

export type Photo = { url: string; credit: string; source: string }

export function details(tags: Record<string, string> | undefined, now = new Date()): Details {
  if (!tags) return {}
  const hours = tags.opening_hours ? openingHours(tags.opening_hours, now) : undefined
  const stars = Number.parseFloat(tags.stars ?? "")
  const website = tags.website ?? tags["contact:website"]
  return {
    openingHours: tags.opening_hours,
    openNow: hours?.openNow,
    hoursToday: hours?.today,
    stars: Number.isFinite(stars) && stars > 0 && stars <= 7 ? stars : undefined,
    phone: tags.phone ?? tags["contact:phone"],
    website: website && /^https?:\/\//i.test(website) ? website : undefined,
    cuisine: tags.cuisine?.split(";").map((part) => part.trim().replace(/_/g, " ")).join(", "),
  }
}

/**
 * The common subset of the OSM opening_hours syntax: "24/7", and ";"-separated rules such as
 * "Mo-Fr 08:00-17:00,19:00-21:00", "Sa,Su 10:00-22:00", "Su off" or "10:00-22:00" (every day), including
 * spans past midnight. Anything else (holidays, months, week numbers) yields undefined rather than a wrong answer.
 */
export function openingHours(value: string, now = new Date()) {
  const text = value.trim()
  if (text === "24/7") return { openNow: true, today: "24 hours" }
  const day = (now.getDay() + 6) % 7
  const minutes = now.getHours() * 60 + now.getMinutes()
  const week = new Map<number, [number, number][]>()
  for (const raw of text.split(";").map((part) => part.trim()).filter(Boolean)) {
    if (/^PH\b/.test(raw)) continue
    const match = raw.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/)
    if (!match) return undefined
    const days = match[1] ? expandDays(match[1]) : [0, 1, 2, 3, 4, 5, 6]
    if (!days) return undefined
    const rest = match[2]!.trim()
    if (rest === "off" || rest === "closed") {
      for (const d of days) week.set(d, [])
      continue
    }
    const spans = rest.split(",").map((span) => span.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/))
    if (!spans.length || spans.some((span) => !span)) return undefined
    const parsed = spans.map((span) => [Number(span![1]) * 60 + Number(span![2]), Number(span![3]) * 60 + Number(span![4])] as [number, number])
    for (const d of days) week.set(d, parsed)
  }
  if (!week.size) return undefined
  const todaySpans = week.get(day) ?? []
  const yesterday = week.get((day + 6) % 7) ?? []
  const openNow =
    todaySpans.some(([from, to]) => (to > from ? minutes >= from && minutes < to : minutes >= from)) ||
    yesterday.some(([from, to]) => to <= from && minutes < to)
  const clock = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
  const today = week.has(day)
    ? todaySpans.length
      ? todaySpans.map(([from, to]) => `${clock(from)}–${clock(to)}`).join(", ")
      : "Closed today"
    : undefined
  return { openNow, today }
}

function expandDays(value: string) {
  const out = new Set<number>()
  for (const part of value.split(",").filter(Boolean)) {
    const [from, to] = part.split("-") as [string, string | undefined]
    const start = DAYS.indexOf(from as (typeof DAYS)[number])
    const end = to ? DAYS.indexOf(to as (typeof DAYS)[number]) : start
    if (start < 0 || end < 0) return undefined
    for (let i = start; ; i = (i + 1) % 7) {
      out.add(i)
      if (i === end) break
    }
  }
  return [...out]
}

const cache = new Map<string, Promise<Photo | undefined>>()

/**
 * A photo for the place: from its OSM links first, else a Wikimedia Commons photo whose title names the place
 * (with its area, or geotagged within 120 m). Cached; never throws.
 */
export function photo(
  tags: Record<string, string> | undefined,
  place?: { name: string; latitude: number; longitude: number; address?: string },
) {
  const link = tags ? (tags.image ?? tags.wikimedia_commons ?? tags.wikipedia ?? tags.wikidata) : undefined
  const key = link ?? (place ? `near:${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}:${place.name}` : undefined)
  if (!key) return Promise.resolve(undefined)
  if (!cache.has(key))
    cache.set(
      key,
      (async () => (link && tags ? await findPhoto(tags) : undefined) ??
        (place ? ((await namedPhoto(place)) ?? (await nearbyPhoto(place))) : undefined))().catch(
        () => undefined,
      ),
    )
  return cache.get(key)!
}

/**
 * A Commons photo whose title names the place: every distinctive word of the name plus one word of its area
 * ("Aeon Mall Bumi Serpong Damai" for ÆON Mall in BSD City, Serpong), so a namesake in another city never matches.
 */
async function namedPhoto(place: { name: string; address?: string }): Promise<Photo | undefined> {
  const words = significant(place.name)
  if (!words.length) return undefined
  const areas = [...new Set(areaWords(place.address ?? ""))].slice(0, 3)
  for (const area of areas) {
    const found = await searchCommons(`${words.join(" ")} ${area}`, (title) =>
      words.every((word) => title.includes(word)) && (ALIASES[area] ?? [area]).some((alias) => title.includes(alias)),
    )
    if (found) return found
  }
  return undefined
}

// Local names that Commons titles spell out in full.
const ALIASES: Record<string, string[]> = { bsd: ["bsd", "bumi serpong damai", "serpong"], jakarta: ["jakarta"] }

function areaWords(address: string) {
  return address
    .split(",")
    .slice(1)
    .flatMap((part) => part.toLowerCase().replace(/\b(kabupaten|kota|city|selatan|utara|barat|timur|tengah)\b/g, " ").split(/\s+/))
    .map((word) => word.replace(/[^a-z]/g, ""))
    .filter((word) => word.length >= 3 && !["jalan", "banten", "indonesia"].includes(word))
}

async function searchCommons(query: string, accept: (title: string) => boolean): Promise<Photo | undefined> {
  const url = new URL(`${base("commons")}/w/api.php`)
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "480",
  }))
    url.searchParams.set(key, value)
  const body = await json(url.toString())
  const pages = Object.values(((body?.query as { pages?: Record<string, unknown> } | undefined)?.pages ?? {}) as Record<string, CommonsPage>)
  const best = pages
    .flatMap((page) => {
      const info = page.imageinfo?.[0]
      if (!info?.thumburl || !/\.(jpe?g|png|webp)$/i.test(page.title)) return []
      const title = page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").toLowerCase().replace(/æ/g, "ae").replace(/[^a-z0-9 ]+/g, " ")
      // Fewer extra words means a photo of the place rather than of something inside it.
      return accept(title) ? [{ page, info, extra: title.split(/\s+/).length }] : []
    })
    .toSorted((a, b) => a.extra - b.extra)[0]
  if (!best) return undefined
  return {
    url: best.info.thumburl!,
    credit: "Wikimedia Commons",
    source: best.info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(best.page.title)}`,
  }
}

async function nearbyPhoto(place: { name: string; latitude: number; longitude: number }): Promise<Photo | undefined> {
  const url = new URL(`${base("commons")}/w/api.php`)
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${place.latitude}|${place.longitude}`,
    ggsradius: "120",
    ggsnamespace: "6",
    ggslimit: "20",
    prop: "coordinates|imageinfo",
    iiprop: "url",
    iiurlwidth: "480",
  }))
    url.searchParams.set(key, value)
  const body = await json(url.toString())
  const pages = Object.values(((body?.query as { pages?: Record<string, unknown> } | undefined)?.pages ?? {}) as Record<string, CommonsPage>)
  const words = significant(place.name)
  const scored = pages.flatMap((page) => {
    const info = page.imageinfo?.[0]
    const coordinate = page.coordinates?.[0]
    if (!info?.thumburl || !coordinate || !/\.(jpe?g|png|webp)$/i.test(page.title)) return []
    const meters = distance(place, { latitude: coordinate.lat, longitude: coordinate.lon })
    const title = significant(page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""))
    const named = words.length > 0 && words.filter((word) => title.includes(word)).length >= Math.min(2, words.length)
    // The file itself must be at the place; a name match alone could be a namesake elsewhere.
    return meters <= 120 && named ? [{ page, info, meters, named }] : []
  })
  const best = scored.toSorted((a, b) => Number(b.named) - Number(a.named) || a.meters - b.meters)[0]
  if (!best) return undefined
  return {
    url: best.info.thumburl!,
    credit: "Wikimedia Commons",
    source: best.info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(best.page.title)}`,
  }
}

type CommonsPage = {
  title: string
  coordinates?: { lat: number; lon: number }[]
  imageinfo?: { thumburl?: string; descriptionurl?: string }[]
}

const STOP = new Set(["the", "and", "hotel", "mall", "jalan", "jl", "bsd", "city", "di", "of", "de"])
function significant(text: string) {
  return text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180
  const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad)
  const y = (b.latitude - a.latitude) * rad
  return Math.sqrt(x * x + y * y) * 6_371_000
}

async function findPhoto(tags: Record<string, string>): Promise<Photo | undefined> {
  const commons = commonsFile(tags.image) ?? commonsFile(tags.wikimedia_commons)
  if (commons) return commonsPhoto(commons)
  if (tags.image && /^https:\/\/\S+\.(?:jpe?g|png|webp)(?:\?\S*)?$/i.test(tags.image))
    return { url: tags.image, credit: new URL(tags.image).hostname, source: tags.image }
  if (tags.wikipedia) {
    const found = await wikipediaPhoto(tags.wikipedia)
    if (found) return found
  }
  if (tags.wikidata) return wikidataPhoto(tags.wikidata)
  return undefined
}

function commonsFile(value: string | undefined) {
  if (!value) return undefined
  const file = value.match(/(?:^|\/wiki\/)(File:[^?#]+)/)?.[1] ?? value.match(/upload\.wikimedia\.org\/.+\/([^/]+\.(?:jpe?g|png|webp))$/i)?.[1]
  return file ? decodeURIComponent(file.replace(/^File:/, "")) : undefined
}

function commonsPhoto(file: string): Photo {
  return {
    url: `${base("commons")}/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=480`,
    credit: "Wikimedia Commons",
    source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
  }
}

async function wikipediaPhoto(tag: string): Promise<Photo | undefined> {
  const [lang, ...rest] = tag.includes(":") ? tag.split(":") : ["en", tag]
  const title = rest.join(":").trim()
  if (!title || !/^[a-z-]{2,12}$/.test(lang!)) return undefined
  const body = await json(`${base("wikipedia", lang)}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`)
  const thumbnail = body?.thumbnail as { source?: string } | undefined
  if (!thumbnail?.source) return undefined
  return { url: thumbnail.source, credit: "Wikipedia", source: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}` }
}

async function wikidataPhoto(id: string): Promise<Photo | undefined> {
  if (!/^Q\d+$/.test(id)) return undefined
  const body = await json(`${base("wikidata")}/wiki/Special:EntityData/${id}.json`)
  const entity = (body?.entities as Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }> | undefined)?.[id]
  const file = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
  return typeof file === "string" ? commonsPhoto(file) : undefined
}

function base(site: "commons" | "wikipedia" | "wikidata", lang = "en") {
  const override = process.env.OPENCODE_MAPS_WIKI_URL
  if (override) return override
  if (site === "commons") return "https://commons.wikimedia.org"
  if (site === "wikidata") return "https://www.wikidata.org"
  return `https://${lang}.wikipedia.org`
}

async function json(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) return undefined
  return (await response.json()) as Record<string, unknown>
}
