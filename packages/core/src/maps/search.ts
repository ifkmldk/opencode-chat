export * as MapsSearch from "./search.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Result } from "effect"
import type { KV } from "../kv.js"
import { MapsCategory } from "./categories.js"
import { MapsEnrich } from "./enrich.js"
import { Geo } from "./geo.js"
import { MapsLinks } from "./links.js"
import { MapsOsm } from "./osm.js"
import { Stations } from "./stations.js"

// fork: OSM-only place search (Google/Gemini removed — no key, never billed).
// Free services: Nominatim/Photon geocoding, OSM place search, FOSSGIS OSRM routing,
// Overpass POIs, Wikimedia photos. Keyless Google Maps URLs live in links.ts
// (open the real Google Maps app/website, no API key needed).
// Category requests ("rumah sakit", "hotel", "tempat wisata") around a place go to Overpass by OSM tag; Nominatim free
// text only handles named places and addresses.

export const notices = {
  osmOnly:
    "Places come from OpenStreetMap (free, no key). Ratings/reviews are not in OSM; they appear only when scraped with attribution, otherwise marked unknown.",
} as const

export type PlaceQuery = {
  query: string
  near?: string
  limit?: number
  openNow?: boolean
  anchor?: Geo.Point | string
  radiusKm?: number
}

export type Point = { name: string; address: string; latitude: number; longitude: number; id?: string }

/** Radius for a category search around a place when none is given. */
export const CATEGORY_RADIUS = 3000

// The context and KV are no longer used (OSM needs no key or quota); callers still pass them.
export function make(ctx?: Context, kv?: KV.Interface) {
  void ctx
  void kv

  const promise = <A>(service: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({
            message: `${service} failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
          }),
      ),
    )

  /**
   * "lat,lng", a place id from an earlier result ("osm:way/123", "place:osm:way/123"), a KRL/MRT/LRT station
   * ("Stasiun Cisauk", "Sudirman"), else the first geocoding match (biased towards `near` when given).
   */
  const resolvePoint = (text: string, near?: Geo.Point) =>
    Effect.gen(function* () {
      const found = yield* promise("geocoding", () => locatePoint(text, near))
      if (!found)
        return yield* new ToolFailure({
          message: `Location not found: ${text}. Pass "lat,lng", a place id from an earlier result, or a fuller name.`,
        })
      return found
    })

  const optionalPoint = (text: string, near?: Geo.Point) =>
    resolvePoint(text, near).pipe(Effect.orElseSucceed(() => undefined))

  const places = (input: PlaceQuery) =>
    Effect.gen(function* () {
      const limit = input.limit ?? 6
      const parsed = MapsCategory.parse(input.query)
      // "rumah sakit dekat Stasiun Tanah Abang" names its own centre when near/anchor are not given.
      const nearText = input.near ?? (input.anchor === undefined ? parsed.place : undefined)
      const near = nearText ? yield* optionalPoint(nearText) : undefined
      const anchor =
        typeof input.anchor === "string" ? yield* optionalPoint(input.anchor, near) : (input.anchor ?? undefined)
      const center = anchor ?? near
      const centreText = typeof input.anchor === "string" ? input.anchor : nearText
      const notes: string[] = [notices.osmOnly]
      if (!center && centreText)
        notes.push(
          `Could not locate "${centreText}", so results are not limited to that area${input.radiusKm !== undefined ? " and the radius filter was not applied" : ""}.`,
        )
      // Nominatim does not understand "dekat X"; once X is the centre only the rest is searched.
      const query = center && parsed.place && parsed.head ? parsed.head : input.query
      const station = Stations.find(input.query)
      if (parsed.kind === "station") {
        const radius = input.radiusKm !== undefined ? input.radiusKm * 1000 : CATEGORY_RADIUS * 2
        const stations = station
          ? [station]
          : center
            ? Stations.nearest(center, { modes: ["krl", "mrt", "lrt"], k: limit })
                .filter((entry) => entry.meters <= radius)
                .map((entry) => entry.station)
            : []
        if (stations.length)
          return output(input, {
            places: stations.map((item) => stationPlace(item, center)),
            notes: [...notes, "Stations come from the bundled KRL/MRT/LRT list (OpenStreetMap)."],
            center,
            kind: parsed.kind,
          })
      }
      const found =
        parsed.kind && parsed.kind !== "station" && center
          ? yield* category({
              kind: parsed.kind,
              name: parsed.name,
              center,
              radiusKm: input.radiusKm,
              limit,
              text: query,
              notes,
            })
          : yield* text({ query, center, radiusKm: input.radiusKm, limit })
      const listed = input.openNow ? openFirst(found.places, notes) : found.places
      // A bare station name ("Cisauk") is the station first, then whatever else carries that name.
      const first = station && !parsed.kind ? [stationPlace(station, center)] : []
      return output(input, {
        places: [...first, ...listed.filter((place) => place.id !== station?.id)].slice(0, limit),
        notes,
        center,
        kind: parsed.kind,
        radiusMeters: found.radiusMeters,
        total: found.total,
      })
    })

  /** Every feature of a category around the centre (Overpass by OSM tag), nearest first. */
  const category = (input: {
    kind: MapsCategory.Kind
    name: string
    center: Geo.Point
    radiusKm?: number
    limit: number
    text: string
    notes: string[]
  }) =>
    Effect.gen(function* () {
      const search = (radiusMeters: number) =>
        Effect.tryPromise({
          try: () =>
            MapsOsm.features({
              selectors: MapsCategory.tags(input.kind),
              centers: [input.center],
              radiusMeters,
              limit: 300,
            }),
          catch: (error) => error,
        }).pipe(Effect.result)
      const radius = input.radiusKm !== undefined ? input.radiusKm * 1000 : CATEGORY_RADIUS
      const first = yield* search(radius)
      // No explicit radius and nothing within 3 km (a quiet suburb): look once more within 10 km.
      const widened =
        Result.isSuccess(first) && !first.success.items.length && input.radiusKm === undefined
          ? yield* search(10_000)
          : undefined
      const answer = widened ?? first
      if (Result.isFailure(answer)) {
        input.notes.push(
          `The OSM category search (Overpass) failed (${answer.failure instanceof Error ? answer.failure.message : String(answer.failure)}); these are Nominatim matches near the place, which can miss many.`,
        )
        return yield* text({
          query: input.text,
          center: input.center,
          radiusKm: radius / 1000,
          limit: input.limit,
          bounded: true,
        })
      }
      const usedRadius = widened ? 10_000 : radius
      if (widened) input.notes.push(`Nothing within ${radius} m, so the search was widened to 10 km.`)
      const withName = answer.success.items.filter((item) => item.name)
      const named = merge(withName)
      const unnamed = answer.success.items.length - withName.length
      if (unnamed) input.notes.push(`${unnamed} unnamed ${input.kind} features were skipped.`)
      if (answer.success.capped)
        input.notes.push(`More than ${answer.success.items.length} matches; the nearest are shown.`)
      const words = input.name.split(" ").filter(Boolean)
      const byName = words.length ? named.filter((item) => nameHas(item, words)) : named
      if (words.length && !byName.length) {
        // "AEON Mall" within 3 km may not exist as a mall object; a named lookup near the centre is the better guess.
        const fallback = yield* text({ query: input.text, center: input.center, limit: input.limit }).pipe(
          Effect.orElseSucceed(() => ({ places: [] as Place[], radiusMeters: undefined, total: undefined })),
        )
        if (fallback.places.length) {
          input.notes.push(
            `No ${input.kind} named "${input.name}" within ${usedRadius} m; these are name matches near the place.`,
          )
          return fallback
        }
        input.notes.push(
          `No ${input.kind} named "${input.name}" within ${usedRadius} m; showing every ${input.kind} there.`,
        )
      }
      const chosen = byName.length ? byName : named
      const enriched = yield* Effect.promise(() =>
        enrich(
          chosen
            .slice(0, Math.max(input.limit * 2, input.limit))
            .map((item) => toPlace(item, MapsCategory.tags(input.kind))),
        ),
      )
      return {
        places: enriched.map((place, index) => ({ ...place, distanceM: chosen[index]!.meters })),
        radiusMeters: usedRadius,
        // Every named match, or Overpass's full count when more matched than were fetched.
        total: byName.length
          ? byName.length
          : answer.success.capped || answer.success.total > answer.success.items.length
            ? answer.success.total
            : named.length,
      }
    })

  /** Nominatim free text for named places and addresses; with a radius, a bounded box is fetched before filtering. */
  const text = (input: { query: string; center?: Geo.Point; radiusKm?: number; limit: number; bounded?: boolean }) =>
    Effect.gen(function* () {
      const radius = input.center && input.radiusKm !== undefined ? input.radiusKm * 1000 : undefined
      const rows = yield* promise("OpenStreetMap search", () =>
        MapsOsm.search(input.query, {
          limit: radius ? 40 : Math.max(input.limit * 2, input.limit),
          ...(input.center ? { near: input.center } : {}),
          ...(radius ? { span: (radius / 111_000) * 1.2, bounded: true } : {}),
          ...(input.bounded !== undefined ? { bounded: input.bounded } : {}),
        }),
      )
      const center = input.center
      const measured = rows.map((row) => ({
        row,
        meters: center ? Math.round(Geo.inverse(center, row).meters) : Number.NaN,
      }))
      // Without a radius Nominatim's own relevance order is kept; with one, nearest first.
      const kept =
        radius === undefined
          ? measured
          : measured.filter((entry) => entry.meters <= radius).toSorted((a, b) => a.meters - b.meters)
      const enriched = yield* Effect.promise(() => enrich(kept.map((entry) => entry.row)))
      return {
        places: enriched.map((place, index) => ({
          ...place,
          ...(center ? { distanceM: kept[index]!.meters } : {}),
        })),
        radiusMeters: radius,
        total: undefined as number | undefined,
      }
    })

  return { promise, resolvePoint, places }
}

/** Coordinates for a place reference, without a ToolFailure (see `make().resolvePoint`). */
export async function locatePoint(text: string, near?: Geo.Point): Promise<Point | undefined> {
  const trimmed = text.trim()
  const point = MapsOsm.parsePoint(trimmed)
  if (point) return { name: trimmed, address: trimmed, ...point }
  const id = trimmed.replace(/^place:/, "")
  const remembered = known.get(id)
  if (remembered) return remembered
  if (/^osm:(node|way|relation)\/\d+$/.test(id)) {
    const station = allStations().find((item) => item.id === id)
    if (station) return stationPoint(station)
    const place = await MapsOsm.lookup(id)
    return (
      place && {
        id: place.id,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
      }
    )
  }
  // Stations come from the bundled list: geocoders answer "Stasiun Cisauk" with a warung named after it.
  const station = MapsOsm.looksLikeAddress(trimmed) ? undefined : Stations.find(trimmed)
  if (station) return stationPoint(station)
  const place = await MapsOsm.geocode(trimmed, near)
  return (
    place && {
      id: place.id,
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
    }
  )
}

// Places returned earlier in this process, so "osm:way/562554943" from maps_search is reused by maps_route instead
// of geocoding its name again (which found a parking lot instead of the mall).
const known = new Map<string, Point>()

/** Makes ids from tool results resolvable by later calls. */
export function remember(
  places: readonly { id: string; name?: string; address?: string; latitude?: number; longitude?: number }[],
) {
  places.forEach((place) => {
    if (place.latitude === undefined || place.longitude === undefined) return
    known.delete(place.id)
    known.set(place.id, {
      id: place.id,
      name: place.name ?? place.id,
      address: place.address ?? place.name ?? place.id,
      latitude: place.latitude,
      longitude: place.longitude,
    })
  })
  while (known.size > 5000) known.delete(known.keys().next().value!)
}

/** OSM places with their free details and, for the first few, a Wikimedia photo (fetched in parallel). */
export async function enrich(places: readonly MapsOsm.Place[], photos = 6): Promise<Place[]> {
  return Promise.all(
    places.map(async (place, index) => {
      const facts = MapsEnrich.details(place.tags)
      const image = index < photos ? await MapsEnrich.photo(place.tags, place) : undefined
      return {
        id: place.id,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        location: "accurate" as const,
        category: label(place),
        url: place.url,
        googleMapsUrl: MapsLinks.place({ name: place.name, latitude: place.latitude, longitude: place.longitude }),
        openNow: facts.openNow,
        hoursToday: facts.hoursToday,
        stars: facts.stars,
        phone: facts.phone,
        website: facts.website,
        cuisine: facts.cuisine,
        photoUrl: image?.url,
        photoCredit: image?.credit,
        source: "openstreetmap" as const,
      }
    }),
  )
}

function output(
  input: PlaceQuery,
  result: {
    places: readonly Place[]
    notes: readonly string[]
    center?: Geo.Point & { name?: string }
    kind?: MapsCategory.Kind
    radiusMeters?: number
    total?: number
  },
) {
  remember(result.places)
  return {
    provider: "openstreetmap",
    query: input.query,
    ...(result.kind ? { category: result.kind } : {}),
    ...(result.center
      ? { center: { name: result.center.name, latitude: result.center.latitude, longitude: result.center.longitude } }
      : {}),
    ...(result.radiusMeters !== undefined ? { radiusMeters: result.radiusMeters } : {}),
    ...(result.total !== undefined ? { total: result.total } : {}),
    places: [...result.places],
    notice: result.notes.join(" "),
    attribution: "© OpenStreetMap contributors",
  }
}

/** open_now: places open now first, then those with unknown hours (most OSM places), never the closed ones. */
function openFirst(places: readonly Place[], notes: string[]) {
  const open = places.filter((place) => place.openNow === true)
  const unknown = places.filter((place) => place.openNow === undefined)
  const closed = places.length - open.length - unknown.length
  notes.push(
    `open_now: ${open.length} open now, ${unknown.length} with unknown hours (listed after them), ${closed} closed (left out).`,
  )
  return [...open, ...unknown]
}

function nameHas(item: MapsOsm.Element, words: readonly string[]) {
  const text = [item.name, item.tags.brand, item.tags.operator, item.tags.official_name, item.tags.alt_name]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * One entry per real place: OSM often maps a hospital or hotel twice (a node and its building, "RS Pelni Petamburan"
 * and "Rumah Sakit Pelni Petamburan"), so features within 300 m whose names match, or one name contains the other, are
 * merged into the nearest one, keeping tags only the other had (address, website).
 */
function merge<T extends MapsOsm.Element>(items: readonly T[]) {
  const key = (item: T) =>
    (item.name ?? "")
      .toLowerCase()
      .replace(/\brsud\b/g, "rumah sakit umum daerah")
      .replace(/\brsu\b/g, "rumah sakit umum")
      .replace(/\brs\b/g, "rumah sakit")
      .replace(/[^a-z0-9]+/g, "")
  const same = (a: string, b: string) =>
    a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))
  return items.reduce<T[]>((kept, item) => {
    const index = kept.findIndex((other) => same(key(other), key(item)) && Geo.inverse(other, item).meters <= 300)
    if (index < 0) return [...kept, item]
    kept[index] = { ...kept[index]!, tags: { ...item.tags, ...kept[index]!.tags } }
    return kept
  }, [])
}

function toPlace(item: MapsOsm.Element, selectors: readonly string[]): MapsOsm.Place {
  return {
    id: item.id,
    name: item.name ?? item.id,
    address: MapsOsm.addressOf(item.tags) ?? "",
    latitude: item.latitude,
    longitude: item.longitude,
    category: MapsOsm.categoryOf(item.tags, selectors).replace("=", "/"),
    url: item.url,
    tags: item.tags,
  }
}

function stationPoint(station: Stations.Station): Point {
  return {
    id: station.id,
    name: `${station.mode === "krl" ? "Stasiun" : station.mode.toUpperCase()} ${station.name}`,
    address: `${station.mode.toUpperCase()} ${station.lines.join(", ")}`,
    latitude: station.latitude,
    longitude: station.longitude,
  }
}

function stationPlace(station: Stations.Station, center: Geo.Point | undefined): Place {
  const point = stationPoint(station)
  return {
    id: station.id,
    name: point.name,
    address: point.address,
    latitude: station.latitude,
    longitude: station.longitude,
    location: "accurate",
    category: `${station.mode.toUpperCase()} station`,
    url: `https://www.openstreetmap.org/${station.id.replace(/^osm:/, "")}`,
    googleMapsUrl: MapsLinks.place({ name: point.name, latitude: station.latitude, longitude: station.longitude }),
    ...(center ? { distanceM: Math.round(Geo.inverse(center, station).meters) } : {}),
    source: "openstreetmap",
  }
}

function allStations() {
  return Stations.list({ modes: ["krl", "mrt", "lrt"] })
}

/** "tourism/hotel" → "Hotel"; unknown values keep their OSM wording. */
function label(place: MapsOsm.Place) {
  const value = place.category?.split("/").at(-1)
  if (!value || value === "yes") return place.category?.split("/")[0]?.replace(/_/g, " ")
  return value.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase())
}

export type Place = {
  id: string
  name: string
  address?: string
  latitude?: number
  longitude?: number
  location?: "accurate" | "approximate"
  category?: string
  openNow?: boolean
  hoursToday?: string
  note?: string
  stars?: number
  phone?: string
  website?: string
  cuisine?: string
  photoUrl?: string
  photoCredit?: string
  url?: string
  googleMapsUrl?: string
  distanceM?: number
  // fork: OSM-only — rating/review/price hanya dari scrape berattribusi, else unknown.
  rating?: number
  ratingCount?: number
  ratingSource?: string
  priceLevel?: string
  priceSource?: string
  source: "openstreetmap" | "scraped"
}
