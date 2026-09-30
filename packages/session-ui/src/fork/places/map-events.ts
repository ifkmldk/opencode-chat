/** fork: bridge from place cards and `place:` links (session-ui) to the app's Map side-panel tab. */
export const MAP_SHOW_EVENT = "opencode:map-show"

export type MapFocus = {
  placeId?: string
  name?: string
  latitude?: number
  longitude?: number
}

export function requestMapShow(focus: MapFocus = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(MAP_SHOW_EVENT, { detail: focus }))
}

export function readMapShowDetail(event: Event): MapFocus | undefined {
  if (typeof CustomEvent !== "undefined" && !(event instanceof CustomEvent)) return undefined
  const detail: unknown = (event as CustomEvent).detail
  if (!detail || typeof detail !== "object") return {}
  const value = detail as Record<string, unknown>
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : undefined)
  const number = (key: string) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : undefined
  return { placeId: text("placeId"), name: text("name"), latitude: number("latitude"), longitude: number("longitude") }
}

/** Keyless Google Maps directions to a place (the user's location as origin). */
export function placeDirectionsUrl(place: { name: string; latitude?: number; longitude?: number; id?: string }) {
  const url = new URL("https://www.google.com/maps/dir/")
  url.searchParams.set("api", "1")
  url.searchParams.set(
    "destination",
    place.latitude !== undefined && place.longitude !== undefined ? `${place.latitude},${place.longitude}` : place.name,
  )
  // Google place IDs only; OpenStreetMap ids ("osm:…", "point:…") and source URLs are not.
  if (place.id && /^[\w-]{16,}$/.test(place.id)) url.searchParams.set("destination_place_id", place.id)
  return url.toString()
}
