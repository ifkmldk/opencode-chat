import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useLanguage } from "@/runtime/i18n/language"
import { mapState } from "./model"
import { placeIcon } from "@opencode/session-ui/place-cards"
import { directionsUrl, type MapPlace } from "./scene"
import "./map.css"

// fork: the Map side-panel tab. Leaflet is bundled (no third-party script); tiles are OpenStreetMap, free and
// keyless. Pins are CSS div icons, so no marker images are fetched.

// CARTO's dark basemap now answers keyless requests with an "API key required" tile, so dark mode darkens the
// OpenStreetMap tiles with a CSS filter instead (map.css).
const TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)

function dark() {
  return document.documentElement.dataset.colorScheme === "dark"
}

// A numbered pin (matches the card strip) with the place's name beside it, like Google Maps.
function pin(number: string, place: MapPlace, active: boolean, named: boolean) {
  const name = place.name.length > 24 ? `${place.name.slice(0, 23)}…` : place.name
  return L.divIcon({
    className: "",
    html: `<span class="oc-map-marker" data-active="${active}"><span class="oc-map-pin">${escape(number)}</span>${
      named || active ? `<span class="oc-map-chip">${placeIcon(place.category)} ${escape(name)}</span>` : ""
    }</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

/** The model's label when it is a short marker ("1", "A"); longer text is the place's name, not a pin label. */
const number = (place: MapPlace, index: number) => (place.label && place.label.length <= 3 ? place.label : String(index + 1))

function popup(place: MapPlace, labels: { directions: string; google: string; open: string; closed: string }) {
  const facts = [
    place.rating !== undefined
      ? `★ ${place.rating.toFixed(1)}${place.ratingCount ? ` (${place.ratingCount.toLocaleString()})` : ""}`
      : "",
    place.category ?? "",
    place.priceLevel ?? "",
  ].filter(Boolean)
  const hours = [
    place.openNow === undefined ? "" : place.openNow ? labels.open : labels.closed,
    place.hoursToday ?? "",
  ].filter(Boolean)
  const directions = new URL("https://www.google.com/maps/dir/")
  directions.searchParams.set("api", "1")
  directions.searchParams.set("destination", `${place.latitude},${place.longitude}`)
  const links = [
    `<a href="${escape(directions.toString())}" target="_blank" rel="noopener noreferrer">${escape(labels.directions)}</a>`,
    place.googleMapsUrl?.startsWith("https://")
      ? `<a href="${escape(place.googleMapsUrl)}" target="_blank" rel="noopener noreferrer">${escape(labels.google)}</a>`
      : "",
  ].filter(Boolean)
  return [
    `<div class="oc-map-popup"><strong>${escape(place.name)}</strong>`,
    facts.length ? `<span>${escape(facts.join(" · "))}</span>` : "",
    hours.length ? `<span data-open="${place.openNow}">${escape(hours.join(" · "))}</span>` : "",
    place.address ? `<span>${escape(place.address)}</span>` : "",
    `<span class="oc-map-links">${links.join("")}</span></div>`,
  ].join("")
}

export function MapPane(props: { sessionID: string | undefined }) {
  const language = useLanguage()
  const scene = createMemo(() => mapState.scene(props.sessionID))
  const [selected, setSelected] = createSignal<string>()
  const [scheme, setScheme] = createSignal(dark() ? "dark" : "light")
  let container: HTMLDivElement | undefined
  let map: L.Map | undefined
  let layer: L.LayerGroup | undefined
  let strip: HTMLDivElement | undefined
  const markers = new Map<string, L.Marker>()

  const labels = () => ({
    directions: language.t("session.map.directions"),
    google: language.t("session.map.googleMaps"),
    open: language.t("session.map.open"),
    closed: language.t("session.map.closed"),
  })
  const allRoute = createMemo(() => {
    const value = scene()
    return value.route?.googleMapsUrl ?? directionsUrl(value.places, value.route?.mode)
  })

  const fit = () => {
    const value = scene()
    const points = [
      ...value.places.map((place) => [place.latitude, place.longitude] as [number, number]),
      ...(value.route?.points ?? []).map((point) => [point.latitude, point.longitude] as [number, number]),
      ...value.areas.flatMap((area) => area.ring.map((point) => [point.latitude, point.longitude] as [number, number])),
      ...value.spots.map((spot) => [spot.latitude, spot.longitude] as [number, number]),
    ]
    if (!map) return
    if (points.length === 1) return map.setView(points[0]!, 15)
    // Leave room for the card strip along the bottom.
    if (points.length)
      map.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [32, 48],
        paddingBottomRight: [32, value.places.length ? 150 : 32],
        maxZoom: 16,
      })
  }

  const focus = (id: string, fly = true) => {
    setSelected(id)
    const marker = markers.get(id)
    if (!marker || !map) return
    if (fly) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 })
    marker.openPopup()
  }

  onMount(() => {
    if (!container) return
    map = L.map(container, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView(
      [-6.2, 106.82],
      11,
    )
    layer = L.layerGroup().addTo(map)
    const observer = new MutationObserver(() => setScheme(dark() ? "dark" : "light"))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] })
    const resize = new ResizeObserver(() => map?.invalidateSize())
    resize.observe(container)
    onCleanup(() => {
      observer.disconnect()
      resize.disconnect()
      map?.remove()
      map = undefined
    })
  })

  onMount(() => {
    if (map) L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: 19 }).addTo(map)
  })

  createEffect(
    on(scene, (value) => {
      if (!map || !layer) return
      layer.clearLayers()
      markers.clear()
      for (const area of value.areas)
        L.polygon(
          area.ring.map((point) => [point.latitude, point.longitude] as [number, number]),
          { className: "oc-map-area" },
        )
          .bindTooltip(area.name ?? "")
          .addTo(layer)
      if (value.route?.points.length)
        L.polyline(
          value.route.points.map((point) => [point.latitude, point.longitude] as [number, number]),
          { className: "oc-map-route", weight: 5 },
        ).addTo(layer)
      for (const spot of value.spots)
        L.circleMarker([spot.latitude, spot.longitude], {
          radius: 7,
          className: spot.spot.startsWith("hot")
            ? "oc-map-hot"
            : spot.spot.startsWith("cold")
              ? "oc-map-cold"
              : "oc-map-spot",
        })
          .bindTooltip(`${spot.name ?? ""} ${spot.spot}${spot.value !== undefined ? ` (${spot.value})` : ""}`.trim())
          .addTo(layer)
      value.places.forEach((place, index) => {
        const marker = L.marker([place.latitude, place.longitude], {
          icon: pin(number(place, index), place, false, value.places.length <= 15),
          title: place.name,
        })
          .bindPopup(popup(place, labels()))
          .on("click", () => setSelected(place.id))
          .addTo(layer!)
        markers.set(place.id, marker)
      })
      fit()
      const target = mapState.focus(props.sessionID)
      if (target?.id && markers.has(target.id)) queueMicrotask(() => focus(target.id!, true))
    }),
  )

  // A card or `place:` link asked for a place; fall back to its coordinates when the scene doesn't have it.
  createEffect(
    on(
      () => mapState.focus(props.sessionID),
      (target) => {
        if (!target || !map) return
        if (target.id && markers.has(target.id)) return focus(target.id)
        if (target.point) map.flyTo([target.point.latitude, target.point.longitude], 16, { duration: 0.6 })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const active = selected()
    const places = scene().places
    places.forEach((place, index) =>
      markers.get(place.id)?.setIcon(pin(number(place, index), place, place.id === active, places.length <= 15)),
    )
    if (active)
      strip
        ?.querySelector(`[data-place="${CSS.escape(active)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" })
  })

  const summary = () => {
    const route = scene().route
    if (!route) return undefined
    const km = route.distanceMeters !== undefined ? `${(route.distanceMeters / 1000).toFixed(1)} km` : undefined
    const minutes = route.durationSeconds !== undefined ? `${Math.round(route.durationSeconds / 60)} min` : undefined
    return [route.label ?? route.mode, km, minutes].filter(Boolean).join(" · ")
  }

  return (
    <div class="flex h-full min-h-0 flex-col" data-component="map-pane" data-scheme={scheme()} data-strip={scene().places.length ? "" : undefined}>
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-v2-border-border-muted px-3">
        <span class="min-w-0 flex-1 truncate text-13-medium text-text-strong">
          {scene().title ?? language.t("session.tab.map")}
          <Show when={summary()}>
            <span class="ml-2 text-12-regular text-v2-text-text-muted">{summary()}</span>
          </Show>
        </span>
        <button type="button" class="oc-map-button" onClick={fit} disabled={!scene().places.length && !scene().route}>
          {language.t("session.map.fit")}
        </button>
        <Show when={allRoute()}>
          {(href) => (
            <a class="oc-map-button" data-primary href={href()} target="_blank" rel="noopener noreferrer">
              {language.t("session.map.routeInGoogleMaps")}
            </a>
          )}
        </Show>
      </div>
      <div class="relative min-h-0 flex-1">
        <div ref={container} class="absolute inset-0" data-slot="map-canvas" />
        <Show when={scene().places.length}>
          <div ref={strip} class="oc-map-strip" data-slot="map-strip">
            <For each={scene().places}>
              {(place, index) => (
                <button
                  type="button"
                  class="oc-map-card"
                  data-place={place.id}
                  data-active={selected() === place.id}
                  onClick={() => focus(place.id)}
                >
                  <span class="oc-map-card-media" title={place.photoCredit}>
                    <Show when={place.photoUrl} fallback={<span>{placeIcon(place.category)}</span>}>
                      {(url) => <img src={url()} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    </Show>
                    <span class="oc-map-card-number">{number(place, index())}</span>
                  </span>
                  <span class="oc-map-card-body">
                    <span class="oc-map-card-name">{place.name}</span>
                    <span class="oc-map-card-meta">
                      {[
                        place.rating !== undefined
                          ? `${place.rating.toFixed(1)} ★`
                          : place.stars
                            ? language.t("session.map.stars", { count: String(place.stars) })
                            : "",
                        place.category ?? "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span
                      class="oc-map-card-hours"
                      data-open={place.openNow === undefined ? undefined : String(place.openNow)}
                    >
                      {place.openNow === undefined
                        ? (place.hoursToday ?? place.address ?? "")
                        : [language.t(place.openNow ? "session.map.open" : "session.map.closed"), place.hoursToday]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={!scene().places.length && !scene().route && !scene().spots.length}>
          <div class="pointer-events-none absolute inset-x-0 top-3 z-[500] mx-auto w-fit rounded-md bg-v2-background-bg-base px-3 py-1.5 text-12-regular text-v2-text-text-muted shadow">
            {language.t("session.map.empty")}
          </div>
        </Show>
      </div>
    </div>
  )
}
