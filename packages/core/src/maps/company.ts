export * as MapsCompany from "./company.js"

import { Effect } from "effect"
import { Geo } from "./geo.js"
import { MapsGooglePage } from "./google-page.js"
import { MapsOsm } from "./osm.js"
import { MapsTransit } from "./transit-buffer.js"

// fork: where a company's office is, from free OSM data. Job boards give only a city, Wikidata headquarters are
// city-level, and Nominatim free text ("Traveloka office Jakarta") finds nothing, but OSM usually has the office or
// its tower ("Traveloka Campus", "Menara Astra", "BFI Tower") under the company's name.

export type Located = {
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly address?: string
  readonly source: "osm-office" | "osm-name" | "address" | "google-maps-page" | "cache"
  readonly osmId?: string
  readonly confidence: "high" | "medium" | "low"
  readonly note?: string
}

export type Request = {
  readonly name: string
  readonly cityHint?: string
  /** The office address from the listing or the company page, when known. */
  readonly address?: string
  /** Features already found nearby (maps_near_transit); a name match there needs no extra request. */
  readonly candidates?: readonly MapsTransit.Feature[]
  /** The city or area printed on the listing ("Jakarta Selatan"), added to the Google Maps search text. */
  readonly place?: string
  /** Epoch ms after which the slow Google Maps page step is skipped (the caller's time budget). */
  readonly deadlineAt?: number
}

export type Lookup = { readonly located?: Located; readonly reason?: string }

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

/** The office location, or undefined. Never fails; answers are cached per normalized company name and city. */
export const locate = (input: Request) => lookup(input).pipe(Effect.map((row) => row.located))

/** Many companies; Nominatim's one-request-per-second queue is the limit, Photon calls overlap. Never fails. */
export const lookupMany = (inputs: readonly Request[]) =>
  Effect.forEach(inputs, (input) => lookup(input), { concurrency: 3 })

/**
 * Like `locate`, with the reason when nothing was found. Steps: the cache; the given candidates; Photon (OSM full
 * text) for the name and, unless that found an office, for a head-office tower named after the brand ("Menara Astra",
 * "BFI Tower"); Nominatim for the name inside the region; then the listing address (an office tower named in it, else
 * the street). The region is Jabodetabek, or about 30 km around a city hint outside it.
 */
export const lookup = Effect.fn("MapsCompany.lookup")(function* (input: Request) {
  const key = normalizeCompany(input.name)
  if (!key) return { reason: `"${input.name}" has no usable company name` } satisfies Lookup
  // A company with offices in several cities is cached per city.
  const cacheKey = `${key}|${input.cityHint?.trim().toLowerCase() || "jabodetabek"}`
  const cached = yield* Effect.promise(() => MapsOsm.cache.get<Located>("company", cacheKey, CACHE_TTL))
  if (cached?.fresh)
    return {
      located: {
        ...cached.value,
        source: "cache",
        note: [`cached ${cached.value.source} result`, cached.value.note].filter(Boolean).join("; "),
      },
    } satisfies Lookup
  const candidate = best(key, (input.candidates ?? []).map(candidateElement))
  const box = yield* region(input.cityHint)
  const found =
    candidate && strong(candidate)
      ? located(input.name, candidate, "candidate")
      : yield* byName(input.name, key, box, candidate)
  // A listing address that names a building is as good as a map match; a street-level one is the last resort, after
  // Google Maps (which knows far more offices than OSM).
  const address = found ? undefined : input.address ? yield* fromAddress(input.address, key, box) : undefined
  const google = found || address?.confidence === "medium" ? undefined : yield* fromGoogle(input, key, box)
  const resolved = found ?? (address?.confidence === "medium" ? address : (google?.located ?? address))
  if (resolved) {
    MapsOsm.cache.set("company", cacheKey, resolved)
    return { located: resolved } satisfies Lookup
  }
  return {
    reason: [
      `no OSM office, building or brand named like "${input.name}" in ${input.cityHint ?? "Jabodetabek"}`,
      input.address ? `the address "${input.address}" could not be geocoded` : "no office address was given to geocode",
      ...(google?.reason ? [google.reason] : []),
    ].join("; "),
  } satisfies Lookup
})

/** "PT Astra International Tbk" → "astra international", "cermati.com" → "cermati". */
export function normalizeCompany(name: string) {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.(com|co\.id|id|io|net|org|ai|app)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const legal = words.filter((word) => !LEGAL.has(word))
  const kept = legal.filter((word) => !SOFT.has(word))
  // "Bank Indonesia" is not any bank: soft words stay when stripping them leaves only generic words.
  const distinctive = kept.some((word) => !GENERIC.has(word))
  return (distinctive ? kept : legal.length ? legal : words).join(" ")
}

/**
 * How well an OSM object matches a company: 1 for the same normalized name ("Kredivo Operations Office" is Kredivo),
 * 0.9 for a head-office tower named after the brand ("Menara Astra" for Astra International), less when the object
 * name carries extra words (a dealer "Daihatsu Astra International"), 0 when unrelated.
 */
export function nameScore(company: string, candidate: string) {
  const all = company.split(" ").filter(Boolean)
  // Place words are dropped on both sides, so a tower name ("Menara Astra") also matches itself.
  const stripped = all.filter((word) => !PLACE_WORDS.has(word))
  const tokens = stripped.length ? stripped : all
  const words = normalizeCompany(candidate).split(" ").filter(Boolean)
  const core = words.filter((word) => !PLACE_WORDS.has(word))
  const tower = words.some((word) => TOWER_WORDS.has(word))
  const brand = brandOf(tokens)
  if (!tokens.length || !core.length) return { score: 0, tower, brandOnly: false }
  if (core.join(" ") === tokens.join(" ")) return { score: 1, tower, brandOnly: false }
  if (tower && brand && core.join(" ") === brand) return { score: 0.9, tower, brandOnly: true }
  if (contains(core, tokens))
    return { score: Math.max(0.5, 0.8 - 0.1 * (core.length - tokens.length)), tower, brandOnly: false }
  const common = tokens.filter((token) => core.includes(token)).length
  return { score: (0.5 * common) / Math.max(tokens.length, core.length), tower, brandOnly: false }
}

/** The best OSM object for a normalized company name, or undefined when nothing matches well enough. */
export function best(company: string, elements: readonly MapsOsm.Element[]) {
  const scored = elements
    .filter((element) => !IGNORED.some((key) => element.tags[key] !== undefined))
    .flatMap((element) => {
      const names = [
        element.name,
        element.tags.brand,
        element.tags.operator,
        element.tags.official_name,
        element.tags.alt_name,
      ].filter((name): name is string => !!name)
      const match = names.map((name) => nameScore(company, name)).toSorted((a, b) => b.score - a.score)[0]
      if (!match || match.score < 0.5) return []
      // A tower named after the company is an office building even when OSM only says building=yes.
      const type = match.tower ? Math.max(0.85, typeScore(element.tags)) : typeScore(element.tags)
      const detail = element.tags["addr:street"] || element.tags["addr:full"] || element.tags.website ? 0.02 : 0
      return [{ element, match, type, score: match.score * 0.6 + type * 0.4 + (match.tower ? 0.15 : 0) + detail }]
    })
    .toSorted((a, b) => b.score - a.score)
  const top = scored[0]
  if (!top) return undefined
  // Other objects with the same name elsewhere (branches, an old head office) lower the confidence.
  const elsewhere = scored.filter(
    (entry) =>
      entry !== top && entry.match.score >= top.match.score && Geo.inverse(entry.element, top.element).meters > 2000,
  )
  return { ...top, elsewhere: elsewhere.length }
}

type Match = NonNullable<ReturnType<typeof best>>

function located(name: string, match: Match, via: "candidate" | "name" | "tower"): Located {
  const tags = match.element.tags
  const office = tags.office !== undefined || tags.building === "office"
  const strong = match.match.score === 1 && (office || match.type >= 0.7 || match.match.tower)
  const confidence =
    match.match.brandOnly || match.elsewhere ? "medium" : strong ? "high" : match.match.score === 1 ? "medium" : "low"
  const note = [
    via === "candidate" ? "matched a feature near the stations" : undefined,
    via === "tower" ? "office tower named in the listing address" : undefined,
    match.match.brandOnly
      ? `head-office tower named after the brand ("${match.element.name}"); verify the company sits there`
      : undefined,
    match.elsewhere
      ? `${match.elsewhere} other OSM object(s) named like the company lie more than 2 km away (branches or an older office)`
      : undefined,
    match.match.score < 1 && !match.match.brandOnly
      ? `OSM name "${match.element.name}" only partly matches "${name}"`
      : undefined,
  ].filter(Boolean)
  return {
    name: match.element.name ?? name,
    latitude: match.element.latitude,
    longitude: match.element.longitude,
    address: MapsOsm.addressOf(tags),
    source: office ? "osm-office" : "osm-name",
    osmId: match.element.id,
    confidence: confidence === "high" && via === "tower" ? "medium" : confidence,
    ...(note.length ? { note: note.join("; ") } : {}),
  }
}

/** An exact name on an office (or office-like building, or a tower named after the company): no need to look further. */
function strong(match: Match) {
  return match.match.score === 1 && (match.element.tags.office !== undefined || match.type >= 0.7 || match.match.tower)
}

function byName(name: string, key: string, box: MapsOsm.Bbox, candidate: Match | undefined) {
  return Effect.gen(function* () {
    const near = centre(box)
    const photon = (query: string) =>
      Effect.tryPromise(() => MapsOsm.photon(query, { bbox: box, near, limit: 8 })).pipe(
        Effect.orElseSucceed(() => [] as MapsOsm.Element[]),
      )
    const via = (match: Match) => (match.element === candidate?.element ? "candidate" : "name")
    const pool = [...(candidate ? [candidate.element] : []), ...(yield* photon(key))]
    const first = best(key, pool)
    if (first && strong(first)) return located(name, first, via(first))
    const brand = brandOf(key.split(" "))
    const towers = brand ? [...(yield* photon(`menara ${brand}`)), ...(yield* photon(`${brand} tower`))] : []
    // Photon's list search with the name as written ("PT Foo Bar Indonesia") ranks differently from the normalized key.
    const raw = name.trim().toLowerCase() !== key ? yield* photon(name) : []
    const withTowers = best(key, [...pool, ...towers, ...raw])
    if (withTowers) return located(name, withTowers, via(withTowers))
    // Photon's index can lag behind OSM; Nominatim, limited to the region, is the last name lookup.
    const rows = yield* Effect.tryPromise(() =>
      MapsOsm.search(key, { limit: 8, near, span: span(box), bounded: true }),
    ).pipe(Effect.orElseSucceed(() => [] as MapsOsm.Place[]))
    const last = best(key, rows.map(placeElement))
    return last ? located(name, last, "name") : undefined
  })
}

/**
 * Google Maps' public search page, read in the headless browser: a place whose name matches the company inside the
 * search box. Consent pages and captchas end the step quietly; the result is "medium" at best (Google's pin for a
 * name match, not an OSM office).
 */
function fromGoogle(input: Request, key: string, box: MapsOsm.Bbox) {
  return Effect.gen(function* () {
    if (input.deadlineAt !== undefined && Date.now() + 30_000 > input.deadlineAt) return { reason: "Google Maps not tried (time budget)" }
    const hint = input.place ?? input.cityHint ?? "Jakarta"
    const answer = yield* Effect.promise(() => MapsGooglePage.search(`${input.name} ${hint}`))
    if (answer.blocked) return { reason: "Google Maps asked for consent or a captcha (not bypassed)" }
    if (answer.error === "disabled") return { reason: undefined }
    if (answer.error) return { reason: `Google Maps page unreadable (${answer.error.slice(0, 60)})` }
    const match = googleMatch(key, answer.hits, box)
    if (!match) return { reason: `no Google Maps place named like "${input.name}"` }
    return {
      located: {
        name: match.hit.name,
        latitude: match.hit.latitude,
        longitude: match.hit.longitude,
        ...(match.hit.address ? { address: match.hit.address } : {}),
        source: "google-maps-page",
        confidence: "medium",
        note: [
          "Google Maps place named like the company",
          match.score < 1 ? `name "${match.hit.name}" only partly matches` : undefined,
          match.elsewhere ? `${match.elsewhere} other place(s) with that name lie more than 2 km away (branches)` : undefined,
        ]
          .filter(Boolean)
          .join("; "),
      } satisfies Located,
    }
  })
}

/** The Google Maps hit for a normalized company name: inside the box, name score at least 0.7, best first. */
export function googleMatch(key: string, hits: readonly MapsGooglePage.Hit[], box: MapsOsm.Bbox) {
  const scored = hits
    .filter((hit) => hit.latitude >= box.south && hit.latitude <= box.north && hit.longitude >= box.west && hit.longitude <= box.east)
    .map((hit) => ({ hit, score: nameScore(key, hit.name).score }))
    .filter((entry) => entry.score >= 0.7)
    .toSorted((a, b) => b.score - a.score)
  const top = scored[0]
  if (!top) return undefined
  const elsewhere = scored.filter((entry) => entry !== top && entry.score >= top.score && Geo.inverse(entry.hit, top.hit).meters > 2000).length
  return { ...top, elsewhere }
}

/** The listing address: an office tower named in it ("Menara Astra", "Sahid Sudirman Center"), else the street. */
function fromAddress(address: string, key: string, box: MapsOsm.Bbox) {
  return Effect.gen(function* () {
    const near = centre(box)
    const tower = towerName(address)
    const towers = tower
      ? yield* Effect.tryPromise(() => MapsOsm.photon(tower, { bbox: box, near, limit: 5 })).pipe(
          Effect.orElseSucceed(() => [] as MapsOsm.Element[]),
        )
      : []
    const towerMatch = tower ? best(normalizeCompany(tower), towers) : undefined
    if (towerMatch && towerMatch.match.score === 1) return located(key, towerMatch, "tower")
    const place = yield* Effect.tryPromise(() =>
      MapsOsm.search(cleanAddress(address), { limit: 1, near, span: span(box), bounded: true }),
    ).pipe(
      Effect.map((rows) => rows[0]),
      Effect.orElseSucceed(() => undefined),
    )
    if (!place) return undefined
    const precise = /^(building|office|amenity|tourism|shop|place\/house)/.test(place.category ?? "")
    return {
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      source: "address",
      osmId: place.id.startsWith("osm:") ? place.id : undefined,
      confidence: precise ? "medium" : "low",
      note: `geocoded from the listing address (${place.category ?? "place"}); the position is ${precise ? "that building" : "the street or area, not the office itself"}`,
    } satisfies Located
  })
}

/** The search box: Jabodetabek, or about 30 km around a city hint outside it. */
function region(cityHint: string | undefined) {
  if (!cityHint) return Effect.succeed(MapsOsm.JABODETABEK)
  return Effect.tryPromise(() => MapsOsm.geocode(cityHint)).pipe(
    Effect.map((place) => {
      const box = MapsOsm.JABODETABEK
      if (!place) return box
      const inside =
        place.latitude >= box.south &&
        place.latitude <= box.north &&
        place.longitude >= box.west &&
        place.longitude <= box.east
      if (inside) return box
      return {
        south: place.latitude - 0.3,
        west: place.longitude - 0.3,
        north: place.latitude + 0.3,
        east: place.longitude + 0.3,
      }
    }),
    Effect.orElseSucceed(() => MapsOsm.JABODETABEK),
  )
}

function centre(box: MapsOsm.Bbox) {
  return { latitude: (box.south + box.north) / 2, longitude: (box.west + box.east) / 2 }
}

function span(box: MapsOsm.Bbox) {
  return Math.max(box.north - box.south, box.east - box.west) / 2
}

/** A Nominatim row as an element: its class/type ("office/company") and extra tags. */
function placeElement(place: MapsOsm.Place): MapsOsm.Element {
  const [key, value] = (place.category ?? "").split("/")
  return {
    id: place.id,
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    tags: { ...place.tags, ...(key && value ? { [key]: value } : {}), name: place.name, "addr:full": place.address },
    url: place.url,
  }
}

function brandOf(tokens: readonly string[]) {
  return tokens.find((token) => token.length >= 3 && !GENERIC.has(token) && !/^\d+$/.test(token))
}

function typeScore(tags: Record<string, string>) {
  if (tags.office === "company") return 1
  if (tags.office) return 0.9
  if (tags.building === "office" || tags.company) return 0.85
  if (tags.building === "commercial" || tags.building === "company" || tags.landuse === "commercial") return 0.7
  if (tags.building) return 0.55
  if (tags.amenity || tags.shop || tags.landuse || tags.craft) return 0.3
  return 0.45
}

function candidateElement(feature: MapsTransit.Feature): MapsOsm.Element {
  return {
    id: feature.id,
    name: feature.name,
    latitude: feature.latitude,
    longitude: feature.longitude,
    tags: feature.tags,
    url: `https://www.openstreetmap.org/${feature.id.replace(/^osm:/, "")}`,
  }
}

function towerName(address: string) {
  const text = address.replace(/\s+/g, " ")
  const before = text.match(
    /\b((?:menara|wisma|graha|gedung|gd\.?|plaza|tower)\s+[\p{L}\p{N}&' -]{2,40}?)(?=\s*(?:,|\blt\b|\blantai\b|\bfloor\b|\bjl\b|\bjalan\b|\bkav\b|$))/iu,
  )
  if (before?.[1]) return before[1].replace(/^gd\.?\s/i, "Gedung ").trim()
  const after = text.match(
    /(?:^|,\s*)([\p{L}\p{N}&' -]{2,40}?\s(?:tower|center|centre|building|office park|square))\b/iu,
  )
  return after?.[1]?.trim()
}

/** Floors, units and RT/RW confuse Nominatim; "Lt. 12, Jl. Jend. Sudirman Kav. 1" → "Jl. Jend. Sudirman Kav. 1". */
function cleanAddress(address: string) {
  return address
    .replace(/\b(lt|lantai|floor|fl|unit|suite|ruang|room)\.?\s*[\w-]+/gi, " ")
    .replace(/\brt\.?\s*\d+\s*\/?\s*rw\.?\s*\d+/gi, " ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
}

function contains(words: readonly string[], tokens: readonly string[]) {
  return words.some((_, start) => tokens.every((token, offset) => words[start + offset] === token))
}

const LEGAL = new Set(
  "pt tbk persero perseroan terbuka cv ud ltd limited inc co corp corporation company llc gmbh bv pte sdn bhd the".split(
    " ",
  ),
)
// Dropped only when a distinctive word remains ("Telkom Indonesia" → "telkom", "Bank Indonesia" stays).
const SOFT = new Set("indonesia group grup holding holdings".split(" "))
// Words that name the place, not the company: "Kredivo Operations Office", "Traveloka Campus", "Menara Astra".
const TOWER_WORDS = new Set("menara wisma graha gedung tower campus kampus headquarters hq".split(" "))
const PLACE_WORDS = new Set([
  ...TOWER_WORDS,
  ..."office offices kantor pusat head operations operational cabang branch building center centre plaza lt lantai".split(
    " ",
  ),
])
// Too common to identify a company on its own.
const GENERIC = new Set(
  "bank asuransi koperasi yayasan global digital teknologi technology tech solusi solution solutions mitra sinar mega prima central asia international internasional nusantara jaya abadi sejahtera makmur sentosa utama karya bersama media data sistem system systems consulting konsultan services service industri industries trading logistik logistics capital finance financial investama properti property".split(
    " ",
  ),
)
// Objects that only carry the name of a company nearby: a bus stop "Menara Astra" or a car park.
const IGNORED = ["highway", "railway", "public_transport", "route", "boundary", "waterway", "natural"]
