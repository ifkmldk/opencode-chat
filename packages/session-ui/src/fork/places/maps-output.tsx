import { createMemo, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { BasicTool } from "../../components/basic-tool"
import type { ToolProps } from "../../tools/tool-renderer"
import { placeIcon } from "./inline-cards"
import { requestMapShow } from "./map-events"

// fork: Gemini-style cards for the maps tools (maps_search, maps_route, maps_poi, map_show). The map itself lives
// once in the side panel's Map tab, where every pin of the chat collects; cards carry only a pin button that
// focuses the place there. Every card has a fixed height, so the timeline never re-measures it.

type Place = {
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
  stars?: number
  photoUrl?: string
  photoCredit?: string
  note?: string
  googleMapsUrl?: string
  url?: string
  source?: "google" | "openstreetmap"
}

function json(value: string | undefined) {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function places(result: Record<string, unknown> | undefined): Place[] {
  const value = result?.places ?? result?.nearest
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const place = item as Record<string, unknown>
    if (typeof place.name !== "string" || !place.name) return []
    return [
      {
        ...(place as Place),
        category: (place.category ?? place.tag) as string | undefined,
        id: typeof place.id === "string" ? place.id : `point:${place.latitude},${place.longitude}`,
      },
    ]
  })
}

function duration(seconds: unknown) {
  if (typeof seconds !== "number") return undefined
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

function distance(meters: unknown) {
  if (typeof meters !== "number") return undefined
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function MapsToolOutput(props: ToolProps) {
  const i18n = useI18n()
  const result = createMemo(() => json(props.output))
  const list = createMemo(() => places(result()))
  const route = createMemo(() => {
    const value = result()
    if (!value || (props.tool !== "maps_route" && !(props.tool === "map_show" && value.route))) return undefined
    const source = (props.tool === "map_show" ? value.route : value) as Record<string, unknown>
    return {
      mode: typeof source.mode === "string" ? source.mode : undefined,
      distance: distance(source.distanceMeters),
      duration: duration(source.durationSeconds),
      googleMapsUrl: typeof source.googleMapsUrl === "string" ? source.googleMapsUrl : undefined,
      notice: typeof value.notice === "string" ? value.notice : undefined,
      from: (value.origin as { name?: string } | undefined)?.name,
      to: (value.destination as { name?: string } | undefined)?.name,
    }
  })
  const title = () => {
    if (props.tool === "map_show") return i18n.t("ui.tool.maps.shown")
    if (props.tool === "maps_route") return i18n.t("ui.tool.maps.route")
    if (props.tool === "maps_poi") return i18n.t("ui.tool.maps.nearby")
    const query = props.input.query
    return query ? i18n.t("ui.tool.maps.searchQuery", { query: String(query) }) : i18n.t("ui.tool.maps.search")
  }
  const subtitle = () => {
    const value = route()
    if (value && props.tool === "maps_route") return [value.distance, value.duration].filter(Boolean).join(" · ")
    return i18n.plural("ui.tool.maps.places", list().length)
  }
  const notice = () => (typeof result()?.notice === "string" ? (result()!.notice as string) : undefined)
  const attribution = () =>
    list().some((place) => place.source === "google")
      ? i18n.t("ui.tool.maps.sourceGoogle")
      : typeof result()?.attribution === "string"
        ? (result()!.attribution as string)
        : undefined

  return (
    <BasicTool
      {...props}
      icon="globe"
      hasContent={list().length > 0 || !!route()}
      defaultOpen
      trigger={{ title: title(), subtitle: subtitle() }}
    >
      <div class="flex flex-col gap-2 p-3" data-component="place-cards">
        <Show when={route()}>
          {(value) => (
            <div
              data-slot="route-card"
              class="flex items-center gap-3 rounded-lg border border-v2-border-border-muted p-3"
            >
              <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-v2-background-bg-layer-02">
                <Icon name="arrow-up-right" size="small" />
              </div>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-13-medium text-text-strong">
                  {[value().from, value().to].filter(Boolean).join(" → ") || i18n.t("ui.tool.maps.route")}
                </span>
                <span class="truncate text-12-regular text-text-weak">
                  {[value().mode, value().distance, value().duration].filter(Boolean).join(" · ") || value().notice}
                </span>
              </div>
              <div class="flex shrink-0 gap-1">
                <button type="button" data-slot="place-action" onClick={() => requestMapShow()}>
                  {i18n.t("ui.tool.maps.viewOnMap")}
                </button>
                <Show when={value().googleMapsUrl}>
                  {(href) => (
                    <a data-slot="place-action" data-primary href={href()} target="_blank" rel="noopener noreferrer">
                      {i18n.t("ui.tool.maps.openGoogleMaps")}
                    </a>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
        <Show when={list().length}>
          <div data-slot="place-carousel">
            <For each={list().slice(0, 12)}>{(place) => <PlaceCard place={place} />}</For>
          </div>
        </Show>
        <Show when={notice() && props.tool !== "maps_route"}>
          <span class="text-11-regular text-text-weak">{notice()}</span>
        </Show>
        <Show when={attribution()}>
          <span class="text-11-regular text-text-weak">{attribution()}</span>
        </Show>
      </div>
    </BasicTool>
  )
}

function PlaceCard(props: { place: Place }) {
  const i18n = useI18n()
  const place = () => props.place
  const focus = () =>
    requestMapShow({ placeId: place().id, name: place().name, latitude: place().latitude, longitude: place().longitude })
  const score = () => {
    const value = place()
    if (value.rating !== undefined) return `${value.rating.toFixed(1)} ★`
    if (value.stars) return i18n.t("ui.tool.maps.stars", { count: String(value.stars) })
    return undefined
  }
  const hours = () => {
    const value = place()
    if (value.openNow === undefined) return value.hoursToday
    return [i18n.t(value.openNow ? "ui.tool.maps.open" : "ui.tool.maps.closed"), value.hoursToday].filter(Boolean).join(" · ")
  }
  return (
    <button
      type="button"
      data-component="place-card"
      data-place-id={place().id}
      title={place().address ?? place().name}
      onClick={focus}
    >
      <span data-slot="place-card-media" title={place().photoCredit}>
        <Show when={place().photoUrl} fallback={<span>{placeIcon(place().category)}</span>}>
          {(url) => <img src={url()} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        </Show>
      </span>
      <span data-slot="place-card-name">{place().name}</span>
      <span data-slot="place-card-meta">{[score(), place().category].filter(Boolean).join(" · ") || place().address}</span>
      <span data-slot="place-card-hours" data-open={place().openNow === undefined ? undefined : String(place().openNow)}>
        {hours() ?? place().address ?? ""}
      </span>
    </button>
  )
}
