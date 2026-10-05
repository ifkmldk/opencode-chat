export * as MapsOsm from "./osm.js"

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

const userAgent = "OpenCode/2 maps tools (+https://opencode.ai)"

const endpoint = {
  nominatim: () => process.env.OPENCODE_MAPS_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  photon: () => process.env.OPENCODE_MAPS_PHOTON_URL ?? "https://photon.komoot.io",
  osrm: () => process.env.OPENCODE_MAPS_OSRM_URL ?? "https://routing.openstreetmap.de",
  overpass: () => process.env.OPENCODE_MAPS_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",
  // fork: public mirrors, tried in order after the main server fails (it returns 504 under load).
  overpassMirrors: () =>
    process.env.OPENCODE_MAPS_OVERPASS_URL
      ? [process.env.OPENCODE_MAPS_OVERPASS_URL]
      : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"],
}

export async function search(query: string, options: { limit?: number; near?: Geo.Point } = {}) {
  // Places before streets: "Teras Kota BSD" should find the mall, not every "Jalan Teras …". Retry without the
  // filter when nothing matches (addresses, areas).
  const places = await searchLayer(query, options, "poi,railway,natural,manmade")
  return places.length ? places : searchLayer(query, options)
}

async function searchLayer(query: string, options: { limit?: number; near?: Geo.Point }, layer?: string) {
  const url = new URL("/search", endpoint.nominatim())
  url.searchParams.set("extratags", "1")
  if (layer) url.searchParams.set("layer", layer)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("limit", String(options.limit ?? 5))
  url.searchParams.set("accept-language", "id,en")
  if (options.near) {
    const span = 0.25
    url.searchParams.set(
      "viewbox",
      [
        options.near.longitude - span,
        options.near.latitude + span,
        options.near.longitude + span,
        options.near.latitude - span,
      ].join(","),
    )
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
  const photon = await photonSearch(query, near).catch(() => undefined)
  if (photon) return photon
  return (await search(query, { limit: 1, near }))[0]
}

export function parsePoint(text: string): Geo.Point | undefined {
  const match = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/)
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

const TAG = /^[a-z][a-z0-9_:]*(=[A-Za-z0-9_ .:-]+)?$/

/** OSM features with the given tags (`amenity`, `shop=convenience`) around a point. */
export async function poi(input: { center: Geo.Point; radiusMeters: number; tags: readonly string[]; limit: number }) {
  const tags = input.tags.filter((tag) => TAG.test(tag))
  if (!tags.length)
    throw new MapsError({ service: "overpass", kind: "rejected", message: "No valid OSM tags (use key or key=value)" })
  const around = `(around:${Math.round(input.radiusMeters)},${input.center.latitude},${input.center.longitude})`
  const selectors = tags.map((tag) => {
    const [key, value] = tag.split("=")
    return `nwr["${key}"${value ? `="${value}"` : ""}]${around};`
  })
  const query = `[out:json][timeout:25];(${selectors.join("")});out center tags ${Math.max(1, Math.min(500, input.limit))};`
  const send = async () => {
    let failure: unknown
    for (const url of endpoint.overpassMirrors()) {
      try {
        return await request("overpass", url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(),
        })
      } catch (error) {
        failure = error
      }
    }
    throw failure
  }
  const body = record(await send())
  const items = (Array.isArray(body.elements) ? body.elements : []).flatMap((element) => {
    const value = record(element)
    const center = record(value.center)
    const latitude = Number(value.lat ?? center.lat)
    const longitude = Number(value.lon ?? center.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    const elementTags = record(value.tags) as Record<string, string>
    const matched = tags.find((tag) => {
      const [key, tagValue] = tag.split("=")
      return tagValue ? elementTags[key!] === tagValue : elementTags[key!] !== undefined
    })
    return [
      {
        id: `osm:${value.type}/${value.id}`,
        name: elementTags.name,
        tag: matched ?? tags[0]!,
        tags: elementTags,
        latitude,
        longitude,
        meters: Math.round(Geo.inverse(input.center, { latitude, longitude }).meters),
        url: `https://www.openstreetmap.org/${value.type}/${value.id}`,
      },
    ]
  })
  return items.toSorted((a, b) => a.meters - b.meters)
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
  const url = new URL("/api", endpoint.photon())
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "1")
  if (near) {
    url.searchParams.set("lat", String(near.latitude))
    url.searchParams.set("lon", String(near.longitude))
  }
  const body = record(await request("photon", url))
  const feature = record(Array.isArray(body.features) ? body.features[0] : undefined)
  const coordinates = record(feature.geometry).coordinates
  const properties = record(feature.properties)
  if (!Array.isArray(coordinates)) return undefined
  const longitude = Number(coordinates[0])
  const latitude = Number(coordinates[1])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  const type = { N: "node", W: "way", R: "relation" }[String(properties.osm_type)]
  const name = typeof properties.name === "string" ? properties.name : query
  const address = [properties.street, properties.city, properties.state, properties.country]
    .filter((part) => typeof part === "string")
    .join(", ")
  return {
    id: type && properties.osm_id ? `osm:${type}/${properties.osm_id}` : `point:${latitude},${longitude}`,
    name,
    address: address || name,
    latitude,
    longitude,
    category: typeof properties.osm_value === "string" ? properties.osm_value : undefined,
    url:
      type && properties.osm_id
        ? `https://www.openstreetmap.org/${type}/${properties.osm_id}`
        : osmPoint({ latitude, longitude }),
  }
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

async function request(service: string, url: URL | string, init: RequestInit = {}, retry = true): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", "user-agent": userAgent, ...init.headers },
    signal: AbortSignal.timeout(25_000),
  }).catch((cause) => {
    throw new MapsError({ service, kind: "unavailable", message: `${service} is unreachable`, cause })
  })
  if ((response.status === 429 || response.status >= 500) && retry) {
    await Bun.sleep(1500)
    return request(service, url, init, false)
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

/** "Jl. Pahlawan Seribu, Serpong, Tangerang Selatan" instead of the full ten-part display name. */
function shortAddress(address: Record<string, unknown>, name: string) {
  const text = (key: string) => (typeof address[key] === "string" ? (address[key] as string) : undefined)
  const road = [text("road"), text("house_number")].filter(Boolean).join(" ")
  const parts = [road, text("suburb") ?? text("village") ?? text("neighbourhood"), text("city") ?? text("town") ?? text("county")]
    .filter((part): part is string => !!part && part !== name && part.length <= 60)
  return parts.length ? [...new Set(parts)].join(", ") : undefined
}

function strings(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length ? Object.fromEntries(entries) : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
