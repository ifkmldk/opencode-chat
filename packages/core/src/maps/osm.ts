export * as MapsOsm from "./osm.js"

import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode/util/global"
import { MapsCategory } from "./categories.js"
import { Geo } from "./geo.js"
import { MapsError } from "./error.js"

// fork: free OpenStreetMap services. Each has a fair-use policy: Nominatim allows at most one request per second
// with an identifying User-Agent, and the FOSSGIS OSRM and Overpass instances are for light, interactive use.
// Base URLs can be overridden for tests.

export type Place = {
  readonly id: string
  readonly name: string
  readonly address: string
  readonly latitude: number
  readonly longitude: number
  readonly category?: string
  readonly url: string
  /** OSM tags (opening_hours, stars, wikidata, …) when the service returned them. */
  readonly tags?: Record<string, string>
}

export type Profile = "car" | "bike" | "foot"

export type Bbox = { readonly south: number; readonly west: number; readonly north: number; readonly east: number }

/** A search centre; an OSM node id ("osm:node/123") lets Overpass search around the node set in one pass. */
export type Centre = Geo.Point & { readonly id?: string }

/** One Overpass result: a node, or a way/relation reduced to its centre. */
export type Element = {
  readonly id: string
  readonly name?: string
  readonly latitude: number
  readonly longitude: number
  readonly tags: Record<string, string>
  readonly url: string
}

/** Jabodetabek, from Rangkasbitung to Cikarang and Bogor to the coast. */
export const JABODETABEK: Bbox = { south: -6.75, west: 106.0, north: -5.95, east: 107.3 }
const INDONESIA: Bbox = { south: -11.2, west: 94.7, north: 6.3, east: 141.1 }

const userAgent = "OpenCode/2 maps tools (+https://opencode.ai)"
const POI_LAYER = "poi,railway,natural,manmade"

const endpoint = {
  nominatim: () => process.env.OPENCODE_MAPS_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  photon: () => process.env.OPENCODE_MAPS_PHOTON_URL ?? "https://photon.komoot.io",
  osrm: () => process.env.OPENCODE_MAPS_OSRM_URL ?? "https://routing.openstreetmap.de",
  // fork: public mirrors. The main server often answers 504 under load; the last mirror that answered is tried first.
  // OPENCODE_MAPS_OVERPASS_URL replaces them with one or more comma-separated URLs.
  overpassMirrors: () =>
    process.env.OPENCODE_MAPS_OVERPASS_URL
      ? process.env.OPENCODE_MAPS_OVERPASS_URL.split(/[\s,]+/).filter(Boolean)
      : [
          "https://overpass-api.de/api/interpreter",
          "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
          "https://overpass.private.coffee/api/interpreter",
          "https://overpass.kumi.systems/api/interpreter",
        ],
  // "" searches worldwide.
  countrycodes: () => process.env.OPENCODE_MAPS_COUNTRYCODES ?? "id",
}

export type SearchOptions = {
  limit?: number
  near?: Geo.Point
  /** Half-size of the search box around `near` in degrees (default 0.25, about 28 km). */
  span?: number
  /** Only return results inside the box. Defaults to true for category queries ("hotel", "rumah sakit") with `near`. */
  bounded?: boolean
}

export async function search(query: string, options: SearchOptions = {}) {
  // Places before streets: "Teras Kota BSD" should find the mall, not every "Jalan Teras …". Addresses and areas
  // ("Jl. Sudirman", "Kecamatan Serpong") search every layer first so a shop on that street does not win.
  if (looksLikeAddress(query)) {
    const any = await searchLayer(query, options)
    return any.length ? any : searchLayer(query, options, POI_LAYER)
  }
  const places = await searchLayer(query, options, POI_LAYER)
  return places.length ? places : searchLayer(query, options)
}

/** Street, block or administrative-area wording, which must not be answered with a POI. */
export function looksLikeAddress(query: string) {
  const text = query.toLowerCase()
  return (
    /\b(jl|jln|jalan|gang|gg|street|road|avenue|blok|block|kav|kavling|rt|rw)\b\.?/.test(text) ||
    /\bkm\.?\s*\d/.test(text) ||
    /\b(kabupaten|kab|kecamatan|kec|kelurahan|kel|desa|provinsi|prov|regency|district|subdistrict|village)\b\.?/.test(
      text,
    ) ||
    /\b(jakarta (pusat|utara|barat|selatan|timur)|tangerang selatan|tangsel|jaksel|jakbar|jakpus|jaktim|jakut)\b/.test(
      text,
    ) ||
    /\b\d{5}\b/.test(text) ||
    /\bno\.?\s*\d/.test(text)
  )
}

async function searchLayer(query: string, options: SearchOptions, layer?: string) {
  const url = new URL("/search", endpoint.nominatim())
  url.searchParams.set("extratags", "1")
  if (layer) url.searchParams.set("layer", layer)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("limit", String(Math.min(40, options.limit ?? 5)))
  url.searchParams.set("accept-language", "id,en")
  const countrycodes = endpoint.countrycodes()
  if (countrycodes) url.searchParams.set("countrycodes", countrycodes)
  if (options.near) {
    const span = options.span ?? 0.25
    url.searchParams.set(
      "viewbox",
      [
        options.near.longitude - span,
        options.near.latitude + span,
        options.near.longitude + span,
        options.near.latitude - span,
      ].join(","),
    )
    // A category word is not a name: without bounded=1 Nominatim returns any "hotel" in the world.
    if (options.bounded ?? MapsCategory.fromText(query) !== undefined) url.searchParams.set("bounded", "1")
  }
  const rows = await nominatim(url)
  return (Array.isArray(rows) ? rows : []).flatMap(nominatimPlace)
}

/** First match for a place name or address: Photon first (fast), then Nominatim. */
export async function geocode(query: string, near?: Geo.Point): Promise<Place | undefined> {
  const point = parsePoint(query)
  if (point)
    return {
      id: `point:${point.latitude},${point.longitude}`,
      name: query,
      address: query,
      ...point,
      url: osmPoint(point),
    }
  const bias = near ?? defaultNear()
  const photon = await photonSearch(query, bias).catch(() => undefined)
  if (photon) return photon
  return (await search(query, { limit: 1, near: bias, bounded: false }))[0]
}

/** An OSM object by id ("osm:way/123" or "way/123") through Nominatim's lookup. */
export async function lookup(id: string): Promise<Place | undefined> {
  const match = id.match(/(node|way|relation)\/(\d+)$/)
  if (!match) return undefined
  const url = new URL("/lookup", endpoint.nominatim())
  url.searchParams.set("osm_ids", `${match[1]![0]!.toUpperCase()}${match[2]}`)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("extratags", "1")
  const rows = await nominatim(url)
  return (Array.isArray(rows) ? rows : []).flatMap(nominatimPlace)[0]
}

export function parsePoint(text: string): Geo.Point | undefined {
  const match = text.trim().match(/^(?:point:)?(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!match) return undefined
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  return { latitude, longitude }
}

export async function route(points: readonly Geo.Point[], profile: Profile) {
  const url = osrmUrl("route", points, profile)
  url.searchParams.set("overview", "full")
  url.searchParams.set("geometries", "polyline6")
  url.searchParams.set("steps", "true")
  const body = record(await osrm(url))
  const first = record(Array.isArray(body.routes) ? body.routes[0] : undefined)
  if (!Object.keys(first).length)
    throw new MapsError({ service: "osrm", kind: "not_found", message: "No route found between these places" })
  return {
    distanceMeters: Number(first.distance ?? 0),
    durationSeconds: Number(first.duration ?? 0),
    geometry: typeof first.geometry === "string" ? first.geometry : undefined,
    legs: (Array.isArray(first.legs) ? first.legs : []).map((leg) => {
      const value = record(leg)
      return {
        distanceMeters: Number(value.distance ?? 0),
        durationSeconds: Number(value.duration ?? 0),
        summary: typeof value.summary === "string" ? value.summary : undefined,
        steps: (Array.isArray(value.steps) ? value.steps : []).slice(0, 40).map((step) => {
          const item = record(step)
          const maneuver = record(item.maneuver)
          return {
            instruction: [maneuver.type, maneuver.modifier].filter((part) => typeof part === "string").join(" "),
            road: typeof item.name === "string" && item.name ? item.name : undefined,
            distanceMeters: Math.round(Number(item.distance ?? 0)),
          }
        }),
      }
    }),
  }
}

/** Best visiting order for the stops between the first and last point (OSRM `trip`). */
export async function trip(points: readonly Geo.Point[], profile: Profile) {
  const url = osrmUrl("trip", points, profile)
  url.searchParams.set("source", "first")
  url.searchParams.set("destination", "last")
  url.searchParams.set("roundtrip", "false")
  url.searchParams.set("overview", "false")
  const body = record(await osrm(url))
  const waypoints = Array.isArray(body.waypoints) ? body.waypoints : []
  if (waypoints.length !== points.length)
    throw new MapsError({ service: "osrm", kind: "not_found", message: "Could not optimise the stop order" })
  return waypoints
    .map((waypoint, input) => ({ input, position: Number(record(waypoint).waypoint_index ?? input) }))
    .toSorted((a, b) => a.position - b.position)
    .map((entry) => entry.input)
}

export async function table(
  points: readonly Geo.Point[],
  profile: Profile,
  options: { sources?: readonly number[]; destinations?: readonly number[] } = {},
) {
  const url = osrmUrl("table", points, profile)
  url.searchParams.set("annotations", "duration,distance")
  if (options.sources) url.searchParams.set("sources", options.sources.join(";"))
  if (options.destinations) url.searchParams.set("destinations", options.destinations.join(";"))
  const body = record(await osrm(url))
  const grid = (value: unknown) =>
    (Array.isArray(value) ? value : []).map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => (typeof cell === "number" ? cell : null)),
    )
  return { durations: grid(body.durations), distances: grid(body.distances) }
}

const KEY = /^[a-z][a-z0-9_:]*$/
// Plain values may hold most name characters; quotes and backslashes would break out of the Overpass string.
const VALUE = /^[\p{L}\p{N}_ .:,'/()&-]+$/u
// Alternatives become a regex, so they are limited to characters with no regex meaning.
const ALTERNATIVE = /^[\p{L}\p{N}_ :-]+$/u
// Every extra key multiplies the regex work on a busy server, so only the keys that carry company names.
const NAME_KEYS = "^(name|brand|operator)$"

/**
 * One OSM tag selector as Overpass filters: "office" (key present), "tourism=hotel", "tourism=hotel|guest_house"
 * (alternatives) and "railway=station+network=KAI Commuter" (both). Undefined when it is not a safe selector.
 */
export function filter(selector: string) {
  const parts = selector.split("+").map((part) => part.trim())
  const filters = parts.map((part) => {
    const index = part.indexOf("=")
    if (index < 0) return KEY.test(part) ? `["${part}"]` : undefined
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!KEY.test(key) || !value) return undefined
    if (!value.includes("|")) return VALUE.test(value) ? `["${key}"="${value}"]` : undefined
    const alternatives = value.split("|").map((item) => item.trim())
    if (!alternatives.every((item) => ALTERNATIVE.test(item))) return undefined
    return `["${key}"~"^(${alternatives.join("|")})$"]`
  })
  if (filters.some((item) => item === undefined)) return undefined
  return filters.join("")
}

/**
 * A case-insensitive name regex from user text: only its letters and digits are kept, so no Overpass or regex
 * syntax can get through. "Kompas Gramedia" also matches "Kompas-Gramedia" and "KompasGramedia".
 */
export function namePattern(text: string) {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
  return words.length ? words.join(".{0,3}") : undefined
}

export type QueryInput = {
  /** OR-ed selectors, see `filter`. May be empty when a name is given. */
  readonly selectors: readonly string[]
  readonly centers?: readonly Centre[]
  readonly radiusMeters?: number
  readonly bbox?: Bbox
  /** User text matched case-insensitively against name, brand and operator. */
  readonly name?: string
  /** Cap on returned elements; the response then also carries the total count. */
  readonly limit?: number
  readonly timeout?: number
}

/** The Overpass QL for a tag (and name) search around centres or inside a box. Throws on unsafe input. */
export function overpassQuery(input: QueryInput) {
  const filters = input.selectors.map((selector) => {
    const value = filter(selector)
    if (value === undefined)
      throw new MapsError({
        service: "overpass",
        kind: "rejected",
        message: `Not a valid OSM tag selector: "${selector}" (use key, key=value, key=a|b, or join with +)`,
      })
    return value
  })
  const regex = input.name ? namePattern(input.name) : undefined
  if (input.name && !regex)
    throw new MapsError({
      service: "overpass",
      kind: "rejected",
      message: `No letters or digits in name "${input.name}"`,
    })
  const named = regex ? `[~"${NAME_KEYS}"~"${regex}",i]` : ""
  if (!filters.length && !named)
    throw new MapsError({ service: "overpass", kind: "rejected", message: "Give at least one OSM tag or a name" })
  const wanted = filters.length ? filters : [""]
  const radius = Math.round(input.radiusMeters ?? 1000)
  const centers = input.centers ?? []
  const nodes = centers.map((center) => center.id?.match(/^osm:node\/(\d+)$/)?.[1])
  const body = (() => {
    if (centers.length && nodes.every((id) => id !== undefined))
      return `node(id:${nodes.join(",")})->.centres;(${wanted.map((item) => `nwr${item}${named}(around.centres:${radius});`).join("")})`
    if (centers.length)
      return `(${centers
        .flatMap((center) =>
          wanted.map(
            (item) =>
              `nwr${item}${named}(around:${radius},${coordinate(center.latitude)},${coordinate(center.longitude)});`,
          ),
        )
        .join("")})`
    const box = input.bbox ?? JABODETABEK
    return `(${wanted.map((item) => `nwr${item}${named}(${box.south},${box.west},${box.north},${box.east});`).join("")})`
  })()
  const timeout = Math.max(5, Math.min(180, Math.round(input.timeout ?? 25)))
  if (input.limit === undefined) return `[out:json][timeout:${timeout}];${body};out center tags;`
  return `[out:json][timeout:${timeout}];${body}->.found;.found out count;.found out center tags ${Math.max(1, Math.round(input.limit))};`
}

export type FeatureResult = {
  readonly items: readonly (Element & { readonly meters?: number })[]
  /** Every match, also those beyond `limit`. */
  readonly total: number
  readonly capped: boolean
  readonly stale?: boolean
}

/**
 * OSM features matching the selectors around the centres (or in the box). With one centre and a limit, the items are
 * the truly nearest: when more matched than were fetched, the search is repeated over a radius that holds them all.
 */
export async function features(input: QueryInput): Promise<FeatureResult> {
  const center = input.centers?.length === 1 ? input.centers[0] : undefined
  const limit = input.limit
  if (limit === undefined || !center) {
    const result = await overpass(overpassQuery(input), wait(input))
    const items = center ? sortByDistance(result.elements, center) : result.elements
    return {
      items: limit === undefined ? items : items.slice(0, limit),
      total: result.total ?? items.length,
      capped: false,
      stale: result.stale,
    }
  }
  // Fetch more than asked, sort by distance, then cut: Overpass returns elements in id order, not nearest first.
  const fetch = Math.min(5000, Math.max(limit * 4, 500))
  const first = await overpass(overpassQuery({ ...input, limit: fetch }), wait(input))
  const total = first.total ?? first.elements.length
  if (total <= first.elements.length)
    return { items: sortByDistance(first.elements, center).slice(0, limit), total, capped: false, stale: first.stale }
  // Area grows with r², so this radius holds about 80% of the fetch cap if features are spread evenly.
  const radius = (input.radiusMeters ?? 1000) * Math.sqrt((fetch * 0.8) / total)
  const inner = await overpass(overpassQuery({ ...input, radiusMeters: radius, limit: fetch }), wait(input)).catch(
    () => undefined,
  )
  const enough = inner && (inner.total ?? 0) <= inner.elements.length && inner.elements.length >= limit
  const items = sortByDistance(enough ? inner.elements : first.elements, center).slice(0, limit)
  return { items, total, capped: !enough, stale: first.stale }
}

/** Client wait per mirror: the server-side query timeout plus transfer time. */
function wait(input: QueryInput) {
  return { timeoutMs: (Math.max(5, Math.min(180, input.timeout ?? 25)) + 10) * 1000 }
}

/** OSM features with the given tags (`amenity`, `shop=convenience`) around a point, nearest first. */
export async function poi(input: { center: Geo.Point; radiusMeters: number; tags: readonly string[]; limit: number }) {
  const tags = input.tags.filter((tag) => filter(tag) !== undefined)
  if (!tags.length)
    throw new MapsError({ service: "overpass", kind: "rejected", message: "No valid OSM tags (use key or key=value)" })
  const result = await features({
    selectors: tags,
    centers: [input.center],
    radiusMeters: input.radiusMeters,
    limit: Math.max(1, Math.min(5000, input.limit)),
  })
  return result.items.map((item) => ({
    ...item,
    tag: tags.find((tag) => matches(item.tags, tag)) ?? tags[0]!,
    meters: item.meters ?? 0,
  }))
}

/** Whether an element's tags satisfy one selector ("office", "tourism=hotel|motel", "a=b+c=d"). */
export function matches(tags: Record<string, string>, selector: string) {
  return selector.split("+").every((part) => {
    const index = part.indexOf("=")
    if (index < 0) return tags[part.trim()] !== undefined
    const value = tags[part.slice(0, index).trim()]
    return (
      value !== undefined &&
      part
        .slice(index + 1)
        .split("|")
        .map((item) => item.trim())
        .includes(value)
    )
  })
}

/** "office=company" for the first selector key the element carries, so results say what they are. */
export function categoryOf(tags: Record<string, string>, selectors: readonly string[]) {
  const key = selectors
    .map((selector) => selector.split("+")[0]!.split("=")[0]!.trim())
    .find((item) => tags[item] !== undefined)
  return key
    ? `${key}=${tags[key]}`
    : (Object.entries(tags)
        .find((entry) => entry[0] !== "name")
        ?.join("=") ?? "feature")
}

/** "Jl. Jend. Sudirman Kav. 5-6, Karet Setiabudi, Jakarta" from addr:* tags. */
export function addressOf(tags: Record<string, string>) {
  if (tags["addr:full"]) return tags["addr:full"]
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ")
  const parts = [
    street,
    tags["addr:subdistrict"] ?? tags["addr:suburb"] ?? tags["addr:village"],
    tags["addr:district"],
    tags["addr:city"],
  ].filter((part): part is string => !!part)
  return parts.length ? [...new Set(parts)].join(", ") : undefined
}

// The mirror that answered last goes first; one that could not be reached at all is skipped for five minutes, so a dead
// mirror does not eat the time budget of every query.
const mirrorState = { preferred: "", down: new Map<string, number>() }
const OVERPASS_TTL = 24 * 60 * 60 * 1000

/**
 * Runs an Overpass query: answers are cached for a day (memory and disk); mirrors are tried in turn with a short
 * timeout each and a shared budget, and when all fail a cached answer older than a day is still used.
 */
export async function overpass(
  query: string,
  options: { timeoutMs?: number } = {},
): Promise<{ elements: Element[]; total?: number; stale?: boolean }> {
  const key = `${endpoint.overpassMirrors().join(" ")}\n${query}`
  const cached = await cache.get<{ elements: Element[]; total?: number }>("overpass", key, OVERPASS_TTL)
  if (cached?.fresh) return cached.value
  const answer = await overpassFetch(query, options.timeoutMs ?? 35_000).catch((error: unknown) => {
    if (cached) return undefined
    throw error
  })
  if (!answer) return { ...cached!.value, stale: true }
  cache.set("overpass", key, answer)
  return answer
}

async function overpassFetch(query: string, timeoutMs: number) {
  const mirrors = endpoint.overpassMirrors()
  const ranked = [
    ...mirrors.filter((url) => url === mirrorState.preferred),
    ...mirrors.filter((url) => url !== mirrorState.preferred),
  ]
  const up = ranked.filter((url) => (mirrorState.down.get(url) ?? 0) < Date.now())
  const order = up.length ? up : ranked
  const deadline = Date.now() + Math.max(timeoutMs, Number(process.env.OPENCODE_MAPS_OVERPASS_BUDGET_MS ?? 60_000))
  const failures: string[] = []
  for (const url of order) {
    const remaining = deadline - Date.now()
    if (remaining < 2_000) break
    const outcome = await request(
      "overpass",
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      },
      { timeout: Math.min(remaining, timeoutMs), retry: false },
    ).then(
      (body) => ({ body: record(body) }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    )
    if ("error" in outcome) {
      if (outcome.error.endsWith("unreachable")) mirrorState.down.set(url, Date.now() + 5 * 60 * 1000)
      failures.push(`${new URL(url).host}: ${outcome.error}`)
      continue
    }
    // A server-side timeout still answers 200, with a "runtime error" remark instead of the full result.
    const remark = typeof outcome.body.remark === "string" ? outcome.body.remark : ""
    if (/runtime error|timed out|out of memory/i.test(remark)) {
      failures.push(`${new URL(url).host}: ${remark.slice(0, 160)}`)
      continue
    }
    mirrorState.preferred = url
    mirrorState.down.delete(url)
    return parseElements(outcome.body)
  }
  throw new MapsError({
    service: "overpass",
    kind: "unavailable",
    message: `Overpass did not answer (${failures.join("; ") || "time budget used up"})`,
  })
}

function parseElements(body: Record<string, unknown>) {
  const raw = Array.isArray(body.elements) ? body.elements : []
  const count = raw.map(record).find((element) => element.type === "count")
  const total = count ? Number(record(count.tags).total) : undefined
  const elements = raw.flatMap((element): Element[] => {
    const value = record(element)
    if (value.type === "count") return []
    const center = record(value.center)
    const latitude = Number(value.lat ?? center.lat)
    const longitude = Number(value.lon ?? center.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    const tags = strings(record(value.tags)) ?? {}
    return [
      {
        id: `osm:${value.type}/${value.id}`,
        name: tags.name,
        latitude,
        longitude,
        tags,
        url: `https://www.openstreetmap.org/${value.type}/${value.id}`,
      },
    ]
  })
  return { elements, ...(total !== undefined && Number.isFinite(total) ? { total } : {}) }
}

function sortByDistance(elements: readonly Element[], center: Geo.Point) {
  return elements
    .map((element) => ({ ...element, meters: Math.round(Geo.inverse(center, element).meters) }))
    .toSorted((a, b) => a.meters - b.meters)
}

function coordinate(value: number) {
  return Math.round(value * 1e7) / 1e7
}

function nominatimPlace(row: unknown): Place[] {
  const item = record(row)
  const latitude = Number(item.lat)
  const longitude = Number(item.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  const display = typeof item.display_name === "string" ? item.display_name : ""
  const name = typeof item.name === "string" && item.name ? item.name : (display.split(",")[0] ?? display)
  const type = typeof item.osm_type === "string" ? item.osm_type : undefined
  const osmID = item.osm_id !== undefined ? String(item.osm_id) : undefined
  const category = [item.category, item.type].filter((part) => typeof part === "string").join("/") || undefined
  return [
    {
      id: type && osmID ? `osm:${type}/${osmID}` : `point:${latitude},${longitude}`,
      name,
      address: shortAddress(record(item.address), name) ?? display,
      tags: strings(record(item.extratags)),
      latitude,
      longitude,
      category,
      url: type && osmID ? `https://www.openstreetmap.org/${type}/${osmID}` : osmPoint({ latitude, longitude }),
    },
  ]
}

async function photonSearch(query: string, near?: Geo.Point): Promise<Place | undefined> {
  const found = await photon(query, { near, limit: 5 })
  // A short area name ("BSD") should be the area, not a monument or junction that happens to carry the name.
  const area = areaLike(query)
    ? found.find((item) => item.tags.place !== undefined || item.tags.boundary !== undefined)
    : undefined
  const item = area ?? found[0]
  if (!item) return undefined
  const key = Object.keys(item.tags).find((tag) => tag !== "name" && !tag.startsWith("addr:"))
  return {
    id: item.id,
    name: item.name ?? query,
    address: addressOf(item.tags) ?? item.name ?? query,
    latitude: item.latitude,
    longitude: item.longitude,
    category: key ? item.tags[key] : undefined,
    url: item.url,
  }
}

/**
 * Photon full-text search (fast, no strict rate limit), as elements whose tags hold the main OSM tag and the address
 * Photon knows. Inside Indonesia by default, or inside the given box.
 */
export async function photon(query: string, options: { near?: Geo.Point; bbox?: Bbox; limit?: number } = {}) {
  const url = new URL("/api", endpoint.photon())
  url.searchParams.set("q", query)
  url.searchParams.set("limit", String(options.limit ?? 5))
  if (options.near) {
    url.searchParams.set("lat", String(options.near.latitude))
    url.searchParams.set("lon", String(options.near.longitude))
  }
  // Photon has no country filter; Indonesia's box keeps "Jl. Sudirman" out of other countries.
  const box = options.bbox ?? (endpoint.countrycodes() === "id" ? INDONESIA : undefined)
  if (box) url.searchParams.set("bbox", [box.west, box.south, box.east, box.north].join(","))
  const body = record(await request("photon", url))
  return (Array.isArray(body.features) ? body.features : []).flatMap((feature): Element[] => {
    const value = record(feature)
    const coordinates = record(value.geometry).coordinates
    const properties = record(value.properties)
    if (!Array.isArray(coordinates)) return []
    const longitude = Number(coordinates[0])
    const latitude = Number(coordinates[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    const type = { N: "node", W: "way", R: "relation" }[String(properties.osm_type)]
    const text = (key: string) => (typeof properties[key] === "string" ? (properties[key] as string) : undefined)
    const tags =
      strings({
        ...(text("osm_key") && text("osm_value") ? { [text("osm_key")!]: text("osm_value") } : {}),
        name: text("name"),
        "addr:street": text("street"),
        "addr:housenumber": text("housenumber"),
        "addr:district": text("district"),
        "addr:city": text("city"),
      }) ?? {}
    return [
      {
        id: type && properties.osm_id ? `osm:${type}/${properties.osm_id}` : `point:${latitude},${longitude}`,
        name: text("name"),
        latitude,
        longitude,
        tags,
        url:
          type && properties.osm_id
            ? `https://www.openstreetmap.org/${type}/${properties.osm_id}`
            : osmPoint({ latitude, longitude }),
      },
    ]
  })
}

/** One to three plain words without a category, address part or digits: probably a district or town name. */
function areaLike(query: string) {
  const words = query.trim().split(/\s+/)
  return (
    words.length <= 3 && !/\d/.test(query) && !looksLikeAddress(query) && MapsCategory.fromText(query) === undefined
  )
}

/**
 * Geocoding bias when the caller gives none: OPENCODE_MAPS_DEFAULT_NEAR ("lat,lng", "" for none), default central
 * Jakarta, so "BSD" or "Jl. Sudirman" resolve in Jabodetabek before other cities. It only ranks; an explicit city
 * in the text still wins.
 */
function defaultNear() {
  return parsePoint(process.env.OPENCODE_MAPS_DEFAULT_NEAR ?? "-6.2,106.8")
}

function osrmUrl(service: "route" | "trip" | "table", points: readonly Geo.Point[], profile: Profile) {
  const coordinates = points.map((point) => `${point.longitude},${point.latitude}`).join(";")
  // FOSSGIS runs one OSRM instance per profile; the profile segment inside the path is ignored.
  return new URL(`/routed-${profile}/${service}/v1/driving/${coordinates}`, endpoint.osrm())
}

function osmPoint(point: Geo.Point) {
  return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`
}

const nominatimQueue = { last: 0, chain: Promise.resolve() as Promise<unknown> }

/** Nominatim's policy is at most one request per second, so every call waits its turn. */
function nominatim(url: URL) {
  const interval = Number(process.env.OPENCODE_MAPS_NOMINATIM_INTERVAL_MS ?? 1100)
  const run = nominatimQueue.chain.then(async () => {
    const wait = nominatimQueue.last + interval - Date.now()
    if (wait > 0) await Bun.sleep(wait)
    nominatimQueue.last = Date.now()
    return request("nominatim", url)
  })
  nominatimQueue.chain = run.catch(() => undefined)
  return run
}

function osrm(url: URL) {
  return request("osrm", url)
}

async function request(
  service: string,
  url: URL | string,
  init: RequestInit = {},
  options: { timeout?: number; retry?: boolean } = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", "user-agent": userAgent, ...init.headers },
    signal: AbortSignal.timeout(options.timeout ?? 25_000),
  }).catch((cause) => {
    throw new MapsError({ service, kind: "unavailable", message: `${service} is unreachable`, cause })
  })
  if ((response.status === 429 || response.status >= 500) && options.retry !== false) {
    await Bun.sleep(1500)
    return request(service, url, init, { ...options, retry: false })
  }
  if (response.status === 429)
    throw new MapsError({ service, kind: "rate_limited", message: `${service} is rate limited` })
  if (!response.ok)
    throw new MapsError({
      service,
      kind: response.status >= 500 ? "unavailable" : "rejected",
      message: `${service} returned HTTP ${response.status}`,
    })
  return response.json().catch((cause) => {
    throw new MapsError({ service, kind: "invalid_response", message: `${service} returned invalid JSON`, cause })
  })
}

/**
 * Small JSON cache in memory and on disk (OPENCODE_MAPS_CACHE_DIR, default <opencode cache>/maps; "off" keeps it in
 * memory only). Entries carry their age so a caller can still use a stale one when the service is down.
 */
export const cache = {
  async get<T>(namespace: string, key: string, ttlMs: number): Promise<{ value: T; fresh: boolean } | undefined> {
    const name = cacheName(namespace, key)
    const entry = memory.get(name) ?? (await readDisk(name))
    if (!entry) return undefined
    remember(name, entry)
    return { value: entry.value as T, fresh: Date.now() - entry.at < ttlMs }
  },
  set(namespace: string, key: string, value: unknown) {
    const name = cacheName(namespace, key)
    const entry = { at: Date.now(), value }
    remember(name, entry)
    const dir = cacheDir()
    if (dir) prune(dir)
    if (dir) void Bun.write(path.join(dir, `${name}.json`), JSON.stringify(entry)).catch(() => undefined)
  },
}

const memory = new Map<string, { at: number; value: unknown }>()

// Stale entries are kept as a fallback for a down service, but only this long; checked once per process.
const STALE_LIMIT = 30 * 24 * 60 * 60 * 1000
const pruned = new Set<string>()

function prune(dir: string) {
  if (pruned.has(dir)) return
  pruned.add(dir)
  void fs
    .readdir(dir)
    .then((names) =>
      Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map((name) =>
            fs
              .stat(path.join(dir, name))
              .then((info) => (Date.now() - info.mtimeMs > STALE_LIMIT ? fs.rm(path.join(dir, name)) : undefined))
              .catch(() => undefined),
          ),
      ),
    )
    .catch(() => undefined)
}

function remember(name: string, entry: { at: number; value: unknown }) {
  memory.delete(name)
  memory.set(name, entry)
  if (memory.size > 300) memory.delete(memory.keys().next().value!)
}

function cacheDir() {
  const dir = process.env.OPENCODE_MAPS_CACHE_DIR ?? path.join(Global.Path.cache, "maps")
  return dir === "off" || dir === "" ? undefined : dir
}

function cacheName(namespace: string, key: string) {
  return `${namespace}-${new Bun.CryptoHasher("sha256").update(key).digest("hex").slice(0, 32)}`
}

async function readDisk(name: string) {
  const dir = cacheDir()
  if (!dir) return undefined
  const value: unknown = await Bun.file(path.join(dir, `${name}.json`))
    .json()
    .catch(() => undefined)
  const entry = record(value)
  return typeof entry.at === "number" && "value" in entry ? { at: entry.at, value: entry.value } : undefined
}

/** "Jl. Pahlawan Seribu, Serpong, Tangerang Selatan" instead of the full ten-part display name. */
function shortAddress(address: Record<string, unknown>, name: string) {
  const text = (key: string) => (typeof address[key] === "string" ? (address[key] as string) : undefined)
  const road = [text("road"), text("house_number")].filter(Boolean).join(" ")
  const parts = [
    road,
    text("suburb") ?? text("village") ?? text("neighbourhood"),
    text("city") ?? text("town") ?? text("county"),
  ].filter((part): part is string => !!part && part !== name && part.length <= 60)
  return parts.length ? [...new Set(parts)].join(", ") : undefined
}

function strings(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length ? Object.fromEntries(entries) : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
