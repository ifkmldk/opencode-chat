export * as MapsSearch from "./search.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect } from "effect"
import type { KV } from "../kv.js"
import { MapsEnrich } from "./enrich.js"
import { Geo } from "./geo.js"
import { MapsLinks } from "./links.js"
import { MapsOsm } from "./osm.js"

// fork: OSM-only place search (Google/Gemini removed — no key, never billed).
// Free services: Nominatim/Photon geocoding, OSM place search, FOSSGIS OSRM routing,
// Overpass POIs, Wikimedia photos. Keyless Google Maps URLs live in links.ts
// (open the real Google Maps app/website, no API key needed).

export const notices = {
  osmOnly:
    "Places come from OpenStreetMap (free, no key). Ratings/reviews are not in OSM; they appear only when scraped with attribution, otherwise marked unknown.",
} as const

export type PlaceQuery = { query: string; near?: string; limit?: number; openNow?: boolean; anchor?: Geo.Point | string; radiusKm?: number }

export function make(ctx: Context, kv: KV.Interface) {
  void ctx
  void kv
  /** OSM-only: no key, no quota guard. Kept as Effect for caller compatibility. */
  const google = Effect.gen(function* () {
    return { ok: false as const, reason: "osm_only" as const }
  })

  // fork: OSM-only — quota errors from a retired Google path always fall back, never bill.
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

  const osmEnabled = Effect.succeed(true)

  const resolvePoint = (text: string) =>
    Effect.gen(function* () {
      const point = MapsOsm.parsePoint(text)
      if (point) return { name: text, address: text, ...point }
      const place = yield* promise("geocoding", () => MapsOsm.geocode(text))
      if (!place) return yield* new ToolFailure({ message: `Location not found: ${text}` })
      return { name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude }
    })

  /** OSM-only places. The Google/Gemini branch was removed (no key, never billed). */
  const places = (input: PlaceQuery) =>
    Effect.gen(function* () {
      const limit = input.limit ?? 6
      const near = input.near ? yield* resolvePoint(input.near).pipe(Effect.orElseSucceed(() => undefined)) : undefined
      const notice = notices.osmOnly
      if (!(yield* osmEnabled)) return yield* new ToolFailure({ message: notice })
      const center = input.anchor
        ? typeof input.anchor === "string"
          ? (yield* resolvePoint(input.anchor).pipe(Effect.orElseSucceed(() => undefined))) ?? near
          : input.anchor
        : near
      const osm = yield* promise("OpenStreetMap search", () => MapsOsm.search(input.query, { limit: Math.max(limit * 2, limit), ...(center ? { near: center } : {}) }))
      let found = yield* Effect.promise(() => enrich(osm))
      // fork: radius filter — yang jauh dibuang, yang dekat diukur + sort. Tanpa center, jangan buang semua.
      if (input.radiusKm !== undefined && center) {
        const maxM = input.radiusKm * 1000
        found = found
          .flatMap((place) =>
            place.latitude !== undefined && place.longitude !== undefined
              ? [{ place, m: Geo.inverse(center, { latitude: place.latitude, longitude: place.longitude }).meters }]
              : [],
          )
          .filter((entry) => entry.m <= maxM)
          .toSorted((a, b) => a.m - b.m)
          .map(({ place, m }) => ({ ...place, distanceM: Math.round(m) }))
      }
      return {
        provider: "openstreetmap",
        query: input.query,
        places: found.slice(0, limit),
        notice,
        attribution: "© OpenStreetMap contributors",
      }
    })

  return { google, promise, osmEnabled, resolvePoint, places }
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
