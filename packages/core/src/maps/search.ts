export * as MapsSearch from "./search.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect } from "effect"
import type { KV } from "../kv.js"
import { MapsEnrich } from "./enrich.js"
import { MapsError } from "./error.js"
import { Geo } from "./geo.js"
import { MapsGoogle } from "./google.js"
import { MapsLinks } from "./links.js"
import { MapsOsm } from "./osm.js"
import { MapsSettings } from "./settings.js"
import { MapsUsage } from "./usage.js"

// fork: Google Maps access shared by the maps tools and research_search: the Gemini key, the free-quota guard,
// the OpenStreetMap fallback, and place search with coordinates cross-checked against OSM geocoding.

export const notices = {
  not_configured:
    "Google Maps (via the free Gemini API) is not set up, so results come from OpenStreetMap (no ratings or opening hours). The user can add a free-tier key in Settings → Maps.",
  disabled:
    "Google Maps is turned off in Settings → Maps, so results come from OpenStreetMap (no ratings or opening hours).",
  unconfirmed:
    "Google Maps is waiting for confirmation in Settings → Maps that the key's project is on the Free tier; results come from OpenStreetMap until then.",
  daily_limit:
    "Today's free Google Maps quota is used up (it resets at midnight Pacific time); results come from OpenStreetMap (no ratings or opening hours).",
} as const

export type PlaceQuery = { query: string; near?: string; limit?: number; openNow?: boolean; anchor?: Geo.Point | string; radiusKm?: number }

export function make(ctx: Context, kv: KV.Interface) {
  /** The Gemini key, if configured (stored credential or env). */
  const geminiKey = Effect.gen(function* () {
    const connection = yield* ctx.integration.connection.active(MapsSettings.GEMINI_INTEGRATION)
    if (!connection) return undefined
    const credential = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
    return credential?.type === "key" ? credential.key : undefined
  })

  /** A key plus a reserved slot in today's free quota, or the reason Google can't be used now. */
  const google = Effect.gen(function* () {
    const key = yield* geminiKey
    if (!key) return { ok: false as const, reason: "not_configured" as const }
    const reason = yield* MapsUsage.blocked(kv)
    if (reason) return { ok: false as const, reason }
    yield* MapsUsage.record(kv)
    return { ok: true as const, key }
  })

  // Google answering 429 on both free models means its real quota is gone (it may be lower than ours): stop
  // trying for the rest of the Pacific day.
  const promise = <A>(service: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
      Effect.tapError((error) =>
        error instanceof MapsError && error.service === "gemini" && error.kind === "rate_limited"
          ? MapsUsage.markExhausted(kv)
          : Effect.void,
      ),
      Effect.mapError((error) =>
        error instanceof MapsError
          ? new ToolFailure({ message: `${error.message} (${error.service})`, error })
          : new ToolFailure({
              message: `${service} failed: ${error instanceof Error ? error.message : String(error)}`,
              error,
            }),
      ),
    )

  const osmEnabled = MapsUsage.settings(kv).pipe(Effect.map((settings) => settings.osmEnabled))

  const resolvePoint = (text: string) =>
    Effect.gen(function* () {
      const point = MapsOsm.parsePoint(text)
      if (point) return { name: text, address: text, ...point }
      const place = yield* promise("geocoding", () => MapsOsm.geocode(text))
      if (!place) return yield* new ToolFailure({ message: `Location not found: ${text}` })
      return { name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude }
    })

  /** Coordinates for a Google place: OSM geocoding cross-checked with the coordinates Gemini reported. */
  const locate = (place: MapsGoogle.Place, near: Geo.Point | undefined) =>
    Effect.gen(function* () {
      const geocoded = yield* Effect.tryPromise(() =>
        MapsOsm.geocode(place.address ? `${place.name}, ${place.address}` : place.name, near),
      ).pipe(Effect.orElseSucceed(() => undefined))
      const reported =
        place.latitude !== undefined && place.longitude !== undefined
          ? { latitude: place.latitude, longitude: place.longitude }
          : undefined
      const agree = geocoded && reported ? Geo.inverse(geocoded, reported).meters <= 300 : false
      const namesMatch = geocoded
        ? MapsGoogle.similar(MapsGoogle.normalize(place.name), MapsGoogle.normalize(geocoded.name))
        : false
      const point = geocoded && (agree || namesMatch || !reported) ? geocoded : (reported ?? geocoded)
      return {
        id: place.id,
        name: place.name,
        address: place.address,
        latitude: point?.latitude,
        longitude: point?.longitude,
        location: point
          ? agree || (namesMatch && !reported)
            ? ("accurate" as const)
            : ("approximate" as const)
          : undefined,
        category: place.category,
        rating: place.rating,
        ratingCount: place.ratingCount,
        priceLevel: place.priceLevel,
        openNow: place.openNow,
        hoursToday: place.hoursToday,
        note: place.note,
        url: place.googleMapsUri,
        googleMapsUrl: place.googleMapsUri,
        source: "google" as const,
      }
    })

  /** Google Maps places when the free quota allows, otherwise OpenStreetMap with a notice saying why. */
  const places = (input: PlaceQuery) =>
    Effect.gen(function* () {
      const limit = input.limit ?? 6
      const near = input.near ? yield* resolvePoint(input.near).pipe(Effect.orElseSucceed(() => undefined)) : undefined
      const access = yield* google
      const googleResult = access.ok
        ? yield* promise("Google Maps", () =>
            MapsGoogle.places(access.key, { query: input.query, near, limit, openNow: input.openNow }),
          ).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((failure) => Effect.succeed({ ok: false as const, failure })),
          )
        : undefined
      if (googleResult?.ok && googleResult.result.places.length) {
        const found = yield* Effect.forEach(googleResult.result.places, (place) => locate(place, near), {
          concurrency: 2,
        })
        return {
          provider: "google",
          query: input.query,
          places: found,
          notice: undefined as string | undefined,
          attribution: "Google Maps",
        }
      }
      const notice = googleResult?.ok
        ? "Google Maps returned no grounded places for this query; results come from OpenStreetMap (no ratings or opening hours)."
        : googleResult
          ? `Google Maps failed (${googleResult.failure.message}); results come from OpenStreetMap (no ratings or opening hours).`
          : notices[access.ok ? "not_configured" : access.reason]
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
  rating?: number
  ratingCount?: number
  priceLevel?: string
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
  source: "google" | "openstreetmap"
}
