export * as MapsLinks from "./links.js"

// fork: keyless Google Maps URLs (https://developers.google.com/maps/documentation/urls/get-started). They open
// the real Google Maps app or website, which computes the live best route (traffic, KRL/TransJakarta) itself.

export type Mode = "driving" | "walking" | "bicycling" | "transit"

export type Stop = {
  readonly name?: string
  readonly latitude?: number
  readonly longitude?: number
  readonly placeId?: string
}

export function place(stop: Stop) {
  const url = new URL("https://www.google.com/maps/search/")
  url.searchParams.set("api", "1")
  url.searchParams.set("query", query(stop))
  if (stop.placeId) url.searchParams.set("query_place_id", stop.placeId)
  return url.toString()
}

/** Google Maps directions. Up to 9 waypoints are honoured by Google Maps on the web. */
export function directions(input: { origin?: Stop; destination: Stop; waypoints?: readonly Stop[]; mode?: Mode }) {
  const url = new URL("https://www.google.com/maps/dir/")
  url.searchParams.set("api", "1")
  if (input.origin) {
    url.searchParams.set("origin", query(input.origin))
    if (input.origin.placeId) url.searchParams.set("origin_place_id", input.origin.placeId)
  }
  url.searchParams.set("destination", query(input.destination))
  if (input.destination.placeId) url.searchParams.set("destination_place_id", input.destination.placeId)
  const waypoints = (input.waypoints ?? []).slice(0, 9)
  if (waypoints.length) url.searchParams.set("waypoints", waypoints.map(query).join("|"))
  if (input.mode) url.searchParams.set("travelmode", input.mode)
  return url.toString()
}

function query(stop: Stop) {
  if (stop.name) return stop.name
  if (stop.latitude !== undefined && stop.longitude !== undefined) return `${stop.latitude},${stop.longitude}`
  return ""
}
