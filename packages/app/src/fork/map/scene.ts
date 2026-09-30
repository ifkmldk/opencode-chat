import type { SessionMessageInfo } from "@opencode/client/promise"

// fork: the Map tab's content, folded from the session's maps tool results in order. map_show replaces the scene
// (it is the model's final shortlist); maps_search and maps_poi add places, maps_route sets the route, and a
// geo_compute hotspots result adds its hot and cold spots.

export const MAP_TAB = "map"

export type MapPoint = { latitude: number; longitude: number }
export type MapPlace = MapPoint & {
  id: string
  name: string
  label?: string
  address?: string
  category?: string
  rating?: number
  ratingCount?: number
  priceLevel?: string
  openNow?: boolean
  hoursToday?: string
  googleMapsUrl?: string
  stars?: number
  photoUrl?: string
  photoCredit?: string
  source?: string
}
export type MapRoute = {
  points: MapPoint[]
  mode?: string
  label?: string
  distanceMeters?: number
  durationSeconds?: number
  googleMapsUrl?: string
}
export type MapSpot = MapPoint & { name?: string; value?: number; spot: string; z?: number }
export type MapScene = {
  title?: string
  places: MapPlace[]
  route?: MapRoute
  areas: { name?: string; ring: MapPoint[] }[]
  spots: MapSpot[]
  /** Every place seen in the session by id, for place cards in replies (the map shows only the shortlist). */
  known: Record<string, MapPlace>
}

export const emptyScene = (): MapScene => ({ places: [], areas: [], spots: [], known: {} })

const MAX_PLACES = 100

const MAP_TOOLS = new Set(["map_show", "maps_search", "maps_poi", "maps_route", "geo_compute"])
// Completed tool output never changes, so each part is parsed once (the fold reruns while a reply streams).
const parsed = new Map<string, Record<string, unknown> | undefined>()

export function sceneFromMessages(messages: readonly SessionMessageInfo[]) {
  return messages.reduce((scene, message) => {
    if (message.type !== "assistant") return scene
    return message.content.reduce((current, item) => {
      if (item.type !== "tool" || item.state.status !== "completed" || !MAP_TOOLS.has(item.name)) return current
      if (!parsed.has(item.id)) parsed.set(item.id, parse(toolText(item.state)))
      const next = applyTool(current, item.name, parsed.get(item.id))
      return next === current ? current : { ...next, known: remember(current.known, next.places) }
    }, scene)
  }, emptyScene())
}

export function applyTool(scene: MapScene, tool: string, value: Record<string, unknown> | undefined): MapScene {
  if (!value) return scene
  if (tool === "map_show") {
    const route = routeFrom(value.route)
    return {
      title: text(value.title),
      // The shortlist keeps what the searches already knew about each place (rating, hours, links).
      places: placesFrom(value.places).map((place) => ({
        ...scene.places.find((known) => known.id === place.id || known.name === place.name),
        ...defined(place),
      })),
      route: route ?? scene.route,
      areas: areasFrom(value.areas),
      spots: scene.spots,
      known: scene.known,
    }
  }
  if (tool === "maps_search") return { ...scene, places: merge(scene.places, placesFrom(value.places)) }
  if (tool === "maps_poi") return { ...scene, places: merge(scene.places, placesFrom(value.nearest)) }
  if (tool === "maps_route") {
    const route = routeFrom(value)
    if (!route) return scene
    const ends = [value.origin, value.destination].flatMap((point, index) => {
      const place = pointFrom(point)
      return place
        ? [
            {
              ...place,
              id: `route:${index}:${place.latitude},${place.longitude}`,
              name: text((point as Record<string, unknown>).name) ?? "",
            },
          ]
        : []
    })
    return {
      ...scene,
      route,
      places: merge(
        scene.places,
        ends.filter((place) => place.name),
      ),
    }
  }
  if (tool === "geo_compute" && value.operation === "hotspots" && Array.isArray(value.spots)) {
    const spots = value.spots.flatMap((spot) => {
      const point = pointFrom(spot)
      if (!point) return []
      const record = spot as Record<string, unknown>
      return [
        {
          ...point,
          name: text(record.name),
          value: num(record.value),
          z: num(record.z),
          spot: text(record.spot) ?? "",
        },
      ]
    })
    return { ...scene, spots }
  }
  return scene
}

/** Decode a Google encoded polyline (precision 5, or 6 for OSRM). */
export function decodePolyline(encoded: string, precision = 5) {
  const factor = 10 ** precision
  const points: MapPoint[] = []
  const state = { index: 0, latitude: 0, longitude: 0 }
  const next = () => {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(state.index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && state.index < encoded.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (state.index < encoded.length) {
    state.latitude += next()
    state.longitude += next()
    points.push({ latitude: state.latitude / factor, longitude: state.longitude / factor })
  }
  return points
}

/** Keyless Google Maps directions through the scene's places, in order (Google allows up to 9 waypoints). */
export function directionsUrl(places: readonly MapPlace[], mode = "driving") {
  if (places.length < 2) return undefined
  const point = (place: MapPlace) => `${place.latitude},${place.longitude}`
  const url = new URL("https://www.google.com/maps/dir/")
  url.searchParams.set("api", "1")
  url.searchParams.set("origin", point(places[0]!))
  url.searchParams.set("destination", point(places[places.length - 1]!))
  const middle = places.slice(1, -1).slice(0, 9)
  if (middle.length) url.searchParams.set("waypoints", middle.map(point).join("|"))
  url.searchParams.set("travelmode", mode === "cycling" ? "bicycling" : mode)
  return url.toString()
}

function toolText(state: { content?: readonly { type: string; text?: string }[] }) {
  return state.content?.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n")
}

export function parse(output: string | undefined) {
  if (!output) return undefined
  try {
    const value: unknown = JSON.parse(output)
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined)

function pointFrom(value: unknown): MapPoint | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const latitude = num(record.latitude)
  const longitude = num(record.longitude)
  if (latitude === undefined || longitude === undefined) return undefined
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined
  return { latitude, longitude }
}

function placesFrom(value: unknown): MapPlace[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const point = pointFrom(item)
    const record = item as Record<string, unknown>
    const name = text(record?.name)
    if (!point || !name) return []
    return [
      {
        ...point,
        id: text(record.id) ?? `point:${point.latitude},${point.longitude}`,
        name,
        label: text(record.label),
        address: text(record.address),
        category: text(record.category) ?? text(record.tag),
        rating: num(record.rating),
        ratingCount: num(record.ratingCount),
        priceLevel: text(record.priceLevel),
        openNow: bool(record.openNow),
        hoursToday: text(record.hoursToday),
        googleMapsUrl: text(record.googleMapsUrl) ?? text(record.url),
        stars: num(record.stars),
        photoUrl: text(record.photoUrl),
        photoCredit: text(record.photoCredit),
        source: text(record.source),
      },
    ]
  })
}

function routeFrom(value: unknown): MapRoute | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const geometry = text(record.geometry)
  const points = geometry ? decodePolyline(geometry, record.precision === 5 ? 5 : 6) : []
  const googleMapsUrl = text(record.googleMapsUrl)
  if (!points.length && !googleMapsUrl) return undefined
  return {
    points,
    mode: text(record.mode),
    label: text(record.label),
    distanceMeters: num(record.distanceMeters),
    durationSeconds: num(record.durationSeconds),
    googleMapsUrl,
  }
}

function areasFrom(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = item as Record<string, unknown>
    const ring = Array.isArray(record?.ring) ? record.ring.flatMap((point) => pointFrom(point) ?? []) : []
    return ring.length >= 3 ? [{ name: text(record.name), ring }] : []
  })
}

function defined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}

function remember(known: Record<string, MapPlace>, places: readonly MapPlace[]) {
  const next = { ...known }
  for (const place of places) next[place.id] = { ...next[place.id], ...defined(place) }
  return next
}

function merge(current: readonly MapPlace[], next: readonly MapPlace[]) {
  const byId = new Map(current.map((place) => [place.id, place]))
  for (const place of next) byId.set(place.id, { ...byId.get(place.id), ...defined(place) })
  return [...byId.values()].slice(-MAX_PLACES)
}
