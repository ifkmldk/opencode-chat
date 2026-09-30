import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"

// Below this, in screen pixels, a drag is an accidental click rather than a selection.
const MIN_SELECTION_PX = 6

// fork: drag a rectangle over a preview, then Quote / + Note it into the composer (v1 annotator).
// The overlay covers its positioned parent; `capture` turns the viewport rectangle into pixels.
export function RegionSelectOverlay(props: {
  active: boolean
  capture: (rect: DOMRect) => Promise<Blob | undefined>
  onAnnotate: (blob: Blob, comment?: string) => void
  onCaptureFailed: () => void
  onDone: () => void
}) {
  // Plain numbers, not point objects: store setters merge objects, so a shared start/current object
  // would drag the anchor along with the pointer.
  const [state, setState] = createStore({
    selecting: false,
    dragging: false,
    capturing: false,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
  })
  let overlay: HTMLDivElement | undefined

  const point = (event: PointerEvent) => {
    const bounds = overlay!.getBoundingClientRect()
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    }
  }
  const box = () => {
    if (!state.selecting) return
    return {
      x: Math.min(state.x0, state.x1),
      y: Math.min(state.y0, state.y1),
      width: Math.abs(state.x1 - state.x0),
      height: Math.abs(state.y1 - state.y0),
    }
  }
  const viewportRect = () => {
    const value = box()
    if (!value || !overlay || state.dragging) return
    const bounds = overlay.getBoundingClientRect()
    return new DOMRect(bounds.left + value.x, bounds.top + value.y, value.width, value.height)
  }
  const clear = () => setState({ selecting: false, dragging: false })

  const submit = async (comment?: string) => {
    const rect = viewportRect()
    if (!rect || state.capturing) return
    // Hide the selection chrome for a frame so a tab capture does not include it.
    setState("capturing", true)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const blob = await props.capture(rect).catch(() => undefined)
    setState("capturing", false)
    if (!blob) return props.onCaptureFailed()
    props.onAnnotate(blob, comment)
    clear()
    props.onDone()
  }

  return (
    <Show when={props.active}>
      <div
        ref={overlay}
        data-component="region-select-overlay"
        class="absolute inset-0 z-20 cursor-crosshair"
        // Native listeners: ancestors in the file panel stop propagation, which starves delegated handlers.
        on:pointerdown={(event) => {
          if (event.button !== 0) return
          overlay!.setPointerCapture(event.pointerId)
          const start = point(event)
          setState({ selecting: true, dragging: true, x0: start.x, y0: start.y, x1: start.x, y1: start.y })
        }}
        on:pointermove={(event) => {
          if (!state.dragging) return
          const current = point(event)
          setState({ x1: current.x, y1: current.y })
        }}
        on:pointerup={(event) => {
          if (!state.dragging) return
          overlay!.releasePointerCapture(event.pointerId)
          setState("dragging", false)
          const value = box()
          if (!value || value.width < MIN_SELECTION_PX || value.height < MIN_SELECTION_PX) clear()
        }}
      >
        <Show when={!state.capturing && box()}>
          {(value) => (
            <div
              class="pointer-events-none absolute rounded-[3px] border-[1.5px] border-dashed border-v2-border-border-focus bg-v2-background-bg-accent/15"
              style={{
                left: `${value().x}px`,
                top: `${value().y}px`,
                width: `${value().width}px`,
                height: `${value().height}px`,
              }}
            />
          )}
        </Show>
      </div>
      <Show when={!state.capturing && viewportRect()}>
        {(rect) => (
          <Portal>
            <SelectionActionBar
              rect={rect()}
              onQuote={() => void submit()}
              onNote={(text) => void submit(text)}
              onCancel={clear}
            />
          </Portal>
        )}
      </Show>
    </Show>
  )
}
