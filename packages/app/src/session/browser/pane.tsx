import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useComposerState } from "@/composer/persistence"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand } from "@/shell/commands/command"
import type { Browser } from "@opencode/plugin-browser/rpc"
import type { createSessionBrowser } from "./model"

export function SessionBrowserPane(props: { browser: ReturnType<typeof createSessionBrowser>; visible: boolean }) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const command = useCommand()
  const prompt = useComposerState()
  const state = props.browser.active
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const registration = props.browser.registration
  const button = { variant: "ghost", size: "large" } as const
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    submitted: false,
    // A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile.
    navigating: false,
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    selection: undefined as
      | { tabID: string; text: string; url: string; rect: { x: number; y: number; width: number; height: number } }
      | undefined,
  })
  const empty = () => !address() && !state()?.loading && !store.navigating
  let surface: HTMLDivElement | undefined
  let addressDisplay: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  const scheme = () => store.address.match(/^https?:\/\//i)?.[0] ?? ""

  command.register("browser.navigation", () => [
    {
      id: "browser.reload",
      title: language.t("command.browser.reload"),
      category: language.t("command.category.view"),
      keybind: "f5",
      disabled: !props.visible || !address(),
      onSelect: () => {
        const tab = state()
        if (tab) props.browser.command({ type: "reload", tabID: tab.id })
      },
    },
  ])

  // The native page always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) =>
    Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
    })
  createEffect(() => {
    const dispose = props.browser.onSelection((value) => {
      if (value.tabID === state()?.id) setStore("selection", value)
    })
    onCleanup(dispose)
  })
  const [regionCapture, setRegionCapture] = createSignal(false)
  const [region, setRegion] = createSignal<{
    requestID: string
    tabID: Browser.TabID
    region: { x: number; y: number; width: number; height: number }
  }>()
  const beginRegion = () => {
    const tab = state()
    if (!tab || !surface) return
    setRegionCapture(true)
    setRegion(undefined)
  }
  const cancelRegion = () => {
    setRegionCapture(false)
    setRegion(undefined)
  }
  const regionPoint = (event: PointerEvent) => {
    const rect = surface!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    }
  }
  const beginRegionPointer = (event: PointerEvent) => {
    if (!regionCapture() || !surface) return
    surface.setPointerCapture(event.pointerId)
    const start = regionPoint(event)
    setRegion({ requestID: crypto.randomUUID(), tabID: state()!.id, region: { ...start, width: 0, height: 0 } })
  }
  const moveRegionPointer = (event: PointerEvent) => {
    const current = region()
    if (!current || !surface) return
    const start = { x: current.region.x, y: current.region.y }
    const point = regionPoint(event)
    setRegion({
      ...current,
      region: {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      },
    })
  }
  const finishRegionPointer = (event: PointerEvent) => {
    const current = region()
    if (!current || current.region.width < 8 || current.region.height < 8) return cancelRegion()
    surface?.releasePointerCapture(event.pointerId)
    setRegionCapture(false)
    void props.browser.region({ ...current, format: "png" }).catch(cancelRegion)
  }
  const onRegion = (value: import("@/runtime/platform/browser-pane").BrowserPaneRegion) => {
    if (value.tabID !== state()?.id) return
    const data = `data:${value.mime};base64,${value.data}`
    prompt.context.add({
      type: "media-annotation",
      surface: "browser",
      imageID: value.requestID,
      blob: { id: data, url: data },
      mime: value.mime,
      sourceURL: value.sourceURL,
    })
    setRegion(undefined)
    schedule(100)
  }

  createEffect(() => {
    const dispose = props.browser.onRegion(onRegion)
    onCleanup(dispose)
  })

  const addSelection = (comment?: string) => {
    const selection = store.selection
    if (!selection) return
    prompt.context.add({
      type: "page-text-annotation",
      sourceURL: selection.url,
      text: selection.text,
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    })
    setStore("selection", undefined)
    schedule(100)
  }

  const selectionStyle = () => {
    const selection = store.selection
    if (!selection || !surface) return undefined
    const bounds = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const x = bounds.left + selection.rect.x / zoom
    const y = bounds.top + selection.rect.y / zoom - 42
    return { left: `${Math.max(4, Math.min(window.innerWidth - 220, x))}px`, top: `${Math.max(4, y)}px` }
  }

  const measure = () => {
    if (!surface) return
    const tab = state()
    if (!tab) {
      registration()?.setLayout()
      return
    }
    const rect = surface.getBoundingClientRect()
    const zoom = platform.webviewZoom?.() ?? 1
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    // The desktop page hides blank and loading documents itself; only hide here
    // while the pane shows its own empty or failed state over the surface.
    const visible =
      props.visible && store.visible && !empty() && !failed() && !dialog.active && !store.selection && !regionCapture() && !covered(rect)
    // The cutout exposes the app backdrop outside the rounded Review card,
    // not the browser surface inside it.
    const color = getComputedStyle(
      surface.closest(".bg-v2-background-bg-deep") ?? document.documentElement,
    ).backgroundColor
    const next = `${tab.id}:${visible}:${left}:${top}:${right}:${bottom}:${color}:${window.devicePixelRatio}`
    if (next !== layout) {
      layout = next
      // Let the browser resolve the semantic backdrop color, including custom
      // themes using color formats that Electron's color parser cannot read.
      if (paint) {
        paint.clearRect(0, 0, 1, 1)
        paint.fillStyle = color
        paint.fillRect(0, 0, 1, 1)
      }
      const rgba = paint?.getImageData(0, 0, 1, 1).data
      registration()?.setLayout({
        tabID: tab.id,
        visible,
        bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
        background: rgba ? [rgba[0], rgba[1], rgba[2], rgba[3]] : undefined,
        radius: Math.round(10 * zoom),
      })
    }
  }
  const tick = () => {
    frame = undefined
    measure()
    if (performance.now() < until) frame = requestAnimationFrame(tick)
  }
  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  createEffect(on([() => state()?.id, address], () => !store.editing && setStore("address", address())))
  // Any reported movement, including a rejected or blocked request, ends the submitted navigation.
  createEffect(
    on(
      [() => state()?.id, () => state()?.generation, () => state()?.loading, () => props.browser.error()],
      () => setStore("navigating", false),
      { defer: true },
    ),
  )
  // A blocked or rejected submission leaves the page where it was; show that page's URL again.
  createEffect(
    on(
      () => props.browser.error(),
      (error) => {
        if (error && !store.editing) setStore("address", address())
      },
      { defer: true },
    ),
  )
  createEffect(
    on(registration, (current) => {
      // Session routes can change before this pane unmounts. Hide the registration
      // that owned the native view, rather than reading the destination's handle.
      onCleanup(() => current?.setLayout())
    }),
  )
  createEffect(
    on(
      [
        () => platform.webviewZoom?.(),
        () => dialog.active,
        () => store.visible,
        () => props.visible,
        () => state()?.id,
        empty,
        failed,
        registration,
      ],
      () => {
        layout = undefined
        // Native views are not clipped by the retained panel's DOM. Hide before
        // the next animation frame so closing the panel cannot leave its page above the app.
        if (!props.visible || !store.visible || dialog.active || !state()) {
          registration()?.setLayout()
          return
        }
        schedule(300)
      },
    ),
  )
  // ResizeObserver runs after layout in the same frame; measuring here instead of on the next
  // animation frame keeps the native view in step with a pane drag.
  createResizeObserver(() => surface, measure)
  createEventListener(window, "resize", () => schedule(300))
  // Floating content portals directly into <body>; keep measuring briefly so
  // the positioner has settled before the overlap check runs.
  const portals = new MutationObserver(() => schedule(300))
  portals.observe(document.body, { childList: true })
  onCleanup(() => portals.disconnect())
  const appearance = new MutationObserver(() => schedule(300))
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
  onCleanup(() => appearance.disconnect())
  createEventListener(window.matchMedia("(prefers-color-scheme: dark)"), "change", () => schedule(300))
  createEventListener(document, "visibilitychange", () => setStore("visible", document.visibilityState === "visible"))
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div class="h-10 shrink-0 flex items-center gap-1 px-3 border-b border-v2-border-border-muted">
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <Tooltip placement="top" value={language.t(direction === "back" ? "common.goBack" : "common.goForward")}>
              <IconButton
                {...button}
                disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                aria-label={language.t(direction === "back" ? "common.goBack" : "common.goForward")}
                onClick={() => {
                  const tab = state()
                  if (tab) props.browser.command({ type: direction, tabID: tab.id })
                }}
                icon={
                  <Icon
                    name={direction === "back" ? "chevron-left" : "chevron-right"}
                    size="small"
                    class="rtl:rotate-180"
                  />
                }
              />
            </Tooltip>
          )}
        </For>
        <Tooltip
          placement="top"
          value={
            <div class="flex items-center gap-2">
              <span>{language.t(state()?.loading ? "prompt.action.stop" : "error.page.action.reload")}</span>
              <Show when={!state()?.loading}>
                <Keybind keys={command.keybindParts("browser.reload")} variant="neutral" />
              </Show>
            </div>
          }
        >
          <IconButton
            {...button}
            disabled={!state()?.loading && !address()}
            aria-label={language.t(state()?.loading ? "prompt.action.stop" : "error.page.action.reload")}
            onClick={() => {
              const tab = state()
              if (tab) props.browser.command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
            }}
            icon={
              <Show when={state()?.loading} fallback={<Icon name="refresh" size="small" />}>
                <Loader />
              </Show>
            }
          />
        </Tooltip>
        <button
          type="button"
          class="rounded px-2 py-1 text-12-regular text-v2-text-text-weak hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
          disabled={!state() || !!regionCapture()}
          onClick={beginRegion}
        >
          Capture region
        </button>
        <form
          dir="ltr"
          class="relative min-w-0 flex-1 h-7 rounded-md hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover text-12-regular"
          onSubmit={(event) => {
            event.preventDefault()
            const tab = state()
            const url = store.address.trim()
            if (!tab) return
            if (url || failed()) {
              setStore({ submitted: true, address: url, navigating: true })
              props.browser.command({ type: "navigate", tabID: tab.id, url: url || "about:blank" })
            }
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            class="w-full h-full px-2 rounded-md border border-transparent bg-transparent text-transparent caret-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
            spellcheck={false}
            autocomplete="off"
            value={store.address}
            disabled={!state()}
            placeholder={language.t("session.browser.address.placeholder")}
            aria-label={language.t("session.browser.address")}
            onFocus={(event) => {
              setStore("editing", true)
              event.currentTarget.select()
            }}
            onClick={(event) => event.currentTarget.select()}
            onBlur={() =>
              setStore({ editing: false, address: store.submitted ? store.address : address(), submitted: false })
            }
            onInput={(event) => setStore("address", event.currentTarget.value)}
            onScroll={(event) => {
              if (addressDisplay) addressDisplay.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
          {/* Keep native input editing and selection while coloring the scheme, including during editing. */}
          <div
            aria-hidden="true"
            class="absolute inset-0 flex items-center px-2 border border-transparent pointer-events-none"
          >
            <div ref={addressDisplay} class="w-full overflow-hidden whitespace-pre text-v2-text-text-base">
              <span class="text-v2-text-text-muted">{scheme()}</span>
              {store.address.slice(scheme().length)}
            </div>
          </div>
        </form>
      </div>
      <Show when={props.browser.error() && !failed()}>
        <div class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger-base border-b border-v2-border-border-muted">
          {props.browser.error()}
        </div>
      </Show>
      <Show when={regionCapture()}>
        <div class="absolute inset-x-0 bottom-3 z-30 flex justify-center">
          <div class="flex items-center gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg">
            <span class="px-2 text-12-regular text-v2-text-text-weak">Drag to select a region</span>
            <IconButton icon={<Icon name="outline-xmark" size="small" />} size="small" variant="ghost" aria-label="Cancel region selection" onClick={cancelRegion} />
          </div>
        </div>
      </Show>
      <div
        ref={surface}
        class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center"
        onPointerDown={beginRegionPointer}
        onPointerMove={moveRegionPointer}
        onPointerUp={finishRegionPointer}
      >
        <Show when={regionCapture()}>
          <div class="pointer-events-none absolute inset-0 z-10 cursor-crosshair">
            <Show when={region()}>
              {(value) => (
                <div
                  class="absolute rounded border-2 border-v2-blue-400 bg-v2-blue-400/15"
                  style={{
                    left: `${value().region.x}px`,
                    top: `${value().region.y}px`,
                    width: `${value().region.width}px`,
                    height: `${value().region.height}px`,
                  }}
                />
              )}
            </Show>
          </div>
        </Show>
        <Show when={store.selection}>
          {(selection) => (
            <div
              data-component="browser-selection-bar"
              class="absolute z-20 flex -translate-y-full items-center gap-1 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg"
              style={selectionStyle()}
            >
              <button
                type="button"
                class="rounded px-2 py-1 text-12-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addSelection()}
              >
                Quote
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 text-12-regular text-v2-text-text-weak hover:bg-v2-overlay-simple-overlay-hover"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const note = window.prompt("Add a note about this selection")
                  if (note) addSelection(note)
                }}
              >
                Note
              </button>
              <IconButton
                icon={<Icon name="outline-xmark" size="small" />}
                size="small"
                variant="ghost"
                aria-label="Cancel browser selection"
                onClick={() => setStore("selection", undefined)}
              />
              <span class="sr-only">{selection().text}</span>
            </div>
          )}
        </Show>
        <Show when={(empty() || failed()) && !props.browser.suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {language.t(failed() ? "session.browser.failed.title" : "session.browser.empty.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">
              {language.t(failed() ? "session.browser.failed.description" : "session.browser.empty.description")}
            </div>
          </div>
        </Show>
        <Show when={props.browser.suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {language.t("session.browser.suspended")}
          </p>
        </Show>
      </div>
    </aside>
  )
}
