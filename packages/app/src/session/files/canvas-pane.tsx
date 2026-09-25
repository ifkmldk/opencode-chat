import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { createBlobReference } from "@/runtime/persistence/drafts"
import type { MediaAnnotationContextItem } from "@/composer/schema"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"

type Point = { x: number; y: number }
type Selection = { start: Point; current: Point }

const MIN_SELECTION_PX = 6

export function CanvasPane(props: { onAnnotate: (item: MediaAnnotationContextItem) => void }) {
  const [imageUrl, setImageUrl] = createSignal<string>()
  const [selection, setSelection] = createSignal<Selection>()
  const [dragging, setDragging] = createSignal(false)
  const [sending, setSending] = createSignal(false)

  let stageEl: HTMLDivElement | undefined
  let imageEl: HTMLImageElement | undefined
  let overlayEl: HTMLCanvasElement | undefined
  let fileInput: HTMLInputElement | undefined

  const loadImageFile = (file: File) => {
    const previous = imageUrl()
    if (previous) URL.revokeObjectURL(previous)
    setImageUrl(URL.createObjectURL(file))
  }

  const onPaste = (event: ClipboardEvent) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith("image/"))
    const file = item?.getAsFile()
    if (file) loadImageFile(file)
  }

  const sizeOverlay = () => {
    const stage = stageEl
    const overlay = overlayEl
    if (!stage || !overlay) return
    const rect = stage.getBoundingClientRect()
    overlay.width = rect.width
    overlay.height = rect.height
    drawSelectionBox()
  }

  onMount(() => {
    document.addEventListener("paste", onPaste)
    const onResize = () => sizeOverlay()
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })
  onCleanup(() => {
    document.removeEventListener("paste", onPaste)
    const url = imageUrl()
    if (url) URL.revokeObjectURL(url)
  })

  const selectionBoundsPx = (overlay: HTMLCanvasElement, sel: Selection) => {
    const x0 = Math.min(sel.start.x, sel.current.x) * overlay.width
    const y0 = Math.min(sel.start.y, sel.current.y) * overlay.height
    const x1 = Math.max(sel.start.x, sel.current.x) * overlay.width
    const y1 = Math.max(sel.start.y, sel.current.y) * overlay.height
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }

  const drawSelectionBox = () => {
    const overlay = overlayEl
    if (!overlay) return
    const ctx = overlay.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    const sel = selection()
    if (!sel) return
    const box = selectionBoundsPx(overlay, sel)
    ctx.fillStyle = "rgba(29, 78, 216, 0.15)"
    ctx.fillRect(box.x, box.y, box.width, box.height)
    ctx.strokeStyle = "#1d4ed8"
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.strokeRect(box.x, box.y, box.width, box.height)
  }

  const normalizedPoint = (event: PointerEvent): Point | undefined => {
    const overlay = overlayEl
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const point = normalizedPoint(event)
    if (!point) return
    overlayEl?.setPointerCapture(event.pointerId)
    setDragging(true)
    setSelection({ start: point, current: point })
    drawSelectionBox()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging()) return
    const point = normalizedPoint(event)
    if (!point) return
    const current = selection()
    if (!current) return
    setSelection({ start: current.start, current: point })
    drawSelectionBox()
  }

  const clearSelection = () => {
    setSelection(undefined)
    const overlay = overlayEl
    if (!overlay) return
    const ctx = overlay.getContext("2d")
    ctx?.clearRect(0, 0, overlay.width, overlay.height)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging()) return
    setDragging(false)
    if (overlayEl?.hasPointerCapture(event.pointerId)) {
      overlayEl.releasePointerCapture(event.pointerId)
    }
    const overlay = overlayEl
    const sel = selection()
    if (!overlay || !sel) return
    const box = selectionBoundsPx(overlay, sel)
    if (box.width < MIN_SELECTION_PX || box.height < MIN_SELECTION_PX) {
      clearSelection()
    }
  }

  const selectionScreenRect = (): DOMRect | undefined => {
    const overlay = overlayEl
    const sel = selection()
    if (!overlay || !sel) return
    const overlayRect = overlay.getBoundingClientRect()
    if (overlay.width === 0 || overlay.height === 0) return
    const scaleX = overlayRect.width / overlay.width
    const scaleY = overlayRect.height / overlay.height
    const box = selectionBoundsPx(overlay, sel)
    return new DOMRect(
      overlayRect.left + box.x * scaleX,
      overlayRect.top + box.y * scaleY,
      box.width * scaleX,
      box.height * scaleY,
    )
  }

  const submitAnnotation = async (note?: string) => {
    const img = imageEl
    const overlay = overlayEl
    const sel = selection()
    if (!img || !overlay || !sel || sending()) return
    setSending(true)
    try {
      const box = selectionBoundsPx(overlay, sel)
      const scaleX = img.naturalWidth / overlay.width
      const scaleY = img.naturalHeight / overlay.height

      const sx = box.x * scaleX
      const sy = box.y * scaleY
      const sw = box.width * scaleX
      const sh = box.height * scaleY

      const crop = document.createElement("canvas")
      crop.width = Math.max(1, Math.round(sw))
      crop.height = Math.max(1, Math.round(sh))
      const ctx = crop.getContext("2d")
      if (!ctx) return
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, crop.width, crop.height)
      const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"))
      if (!blob) return
      const ref = await createBlobReference(blob)
      props.onAnnotate({
        type: "media-annotation",
        surface: "canvas",
        imageID: ref.id,
        blob: ref,
        mime: "image/png",
        comment: note?.trim() || undefined,
      })
      clearSelection()
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex shrink-0 items-center gap-1 border-b border-v2-border-border-base p-2">
        <div class="text-12-regular text-v2-text-text-weak">Drag to select an area to annotate</div>
        <div class="flex-1" />
        <input
          ref={(el) => (fileInput = el)}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) loadImageFile(file)
            event.currentTarget.value = ""
          }}
        />
        <button
          type="button"
          class="rounded px-2 py-1 text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          onClick={() => fileInput?.click()}
        >
          Upload image
        </button>
      </div>
      <div class="relative min-h-0 flex-1 overflow-auto bg-v2-background-bg-base">
        <Show
          when={imageUrl()}
          fallback={
            <div class="flex h-full flex-col items-center justify-center gap-1 text-v2-text-text-weak">
              <div class="text-13-regular">Paste an image (Ctrl/Cmd+V) or upload one to annotate</div>
            </div>
          }
        >
          {(url) => (
            <div ref={(el) => (stageEl = el)} class="relative inline-block">
              <img
                ref={(el) => (imageEl = el)}
                src={url()}
                alt=""
                class="block max-w-full"
                onLoad={() => sizeOverlay()}
                style={{ "pointer-events": "none" }}
              />
              <canvas
                ref={(el) => (overlayEl = el)}
                class="absolute inset-0 cursor-crosshair"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            </div>
          )}
        </Show>
      </div>
      <Show when={selectionScreenRect()}>
        {(rect) => (
          <Portal>
            <SelectionActionBar
              rect={rect()}
              onQuote={() => void submitAnnotation()}
              onNote={(text) => void submitAnnotation(text)}
              onCancel={clearSelection}
            />
          </Portal>
        )}
      </Show>
    </div>
  )
}