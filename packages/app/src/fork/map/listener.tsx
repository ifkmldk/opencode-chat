import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, onMount } from "solid-js"
import { MAP_SHOW_EVENT, readMapShowDetail, type MapFocus } from "@opencode/session-ui/map-events"
import type { SessionModel } from "@/session/model"
import { useSessionLayout } from "@/session/session-layout"
import { mapState } from "./model"
import { MAP_TAB, sceneFromMessages } from "./scene"

const MAP_RESULT_TOOLS = new Set(["maps_search", "maps_route", "maps_poi", "map_show"])

/**
 * fork: keeps the Map tab's scene in step with the session's maps tool results. The tab opens on the first maps
 * result of a turn (every pin and route of the chat collects on that one map), when a place card asks for it, or
 * when a `[Name](place:<id>)` link is clicked.
 * Mounted with the session screen because the side panel is unmounted while closed.
 */
export function MapListener(props: { session: SessionModel }) {
  const { tabs, view } = useSessionLayout()
  const session = () => props.session.identity.sessionID()
  const scene = createMemo(() => sceneFromMessages(props.session.history.messages()))
  const running = new Set<string>()
  const settled = new Set<string>()
  // One automatic open per reply, so closing the tab mid-turn sticks.
  const opened = new Set<string>()

  const open = (focus?: MapFocus) => {
    const id = session()
    if (!id) return
    if (focus && (focus.placeId || focus.latitude !== undefined))
      mapState.setFocus(id, {
        id: focus.placeId,
        point:
          focus.latitude !== undefined && focus.longitude !== undefined
            ? { latitude: focus.latitude, longitude: focus.longitude }
            : undefined,
      })
    tabs().open(MAP_TAB)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    tabs().setActive(MAP_TAB)
  }

  createEffect(() => {
    const id = session()
    if (id) mapState.setScene(id, scene())
  })

  createEffect(() => {
    const last = props.session.history.messages().at(-1)
    if (!last || last.type !== "assistant") return
    for (const item of last.content) {
      if (item.type !== "tool" || !MAP_RESULT_TOOLS.has(item.name) || settled.has(item.id)) continue
      if (item.state.status !== "completed" && item.state.status !== "error") {
        running.add(item.id)
        continue
      }
      settled.add(item.id)
      if (!running.delete(item.id) || item.state.status !== "completed") continue
      if (item.name !== "map_show" && opened.has(last.id)) continue
      opened.add(last.id)
      open()
    }
  })

  onMount(() => {
    const placeLink = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("a[data-place-ref]")?.dataset.placeRef : undefined
    // makeEventListener removes each listener when the screen unmounts.
    makeEventListener(window, MAP_SHOW_EVENT, (event) => open(readMapShowDetail(event)))
    makeEventListener(document, "click", (event) => {
      const id = placeLink(event.target)
      if (!id || event.button !== 0) return
      event.preventDefault()
      open({ placeId: id })
    })
    makeEventListener(document, "keydown", (event) => {
      const id = event.key === "Enter" ? placeLink(event.target) : undefined
      if (!id) return
      event.preventDefault()
      open({ placeId: id })
    })
  })
  return null
}
