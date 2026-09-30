import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"

// fork: PDF preview drawn with pdf.js into canvases. Chromium's built-in viewer does not render inside the app's
// blob frames (the frame inherits the page CSP, which blocks the viewer plugin, and some browsers download PDFs
// instead), so the side panel showed nothing. Pages render lazily as they scroll into view, at the pane width.

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const GAP = 12

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist")
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // pdf.js transfers the buffer to its worker; copy so the caller's bytes stay usable.
  return pdfjs.getDocument({ data: bytes.slice() })
}

export function PdfPages(props: { bytes: Uint8Array | undefined; title: string }) {
  const language = useLanguage()
  const [doc, setDoc] = createSignal<PDFDocumentProxy>()
  const [failed, setFailed] = createSignal(false)
  const [sizes, setSizes] = createSignal<{ width: number; height: number }[]>([])
  const [width, setWidth] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  let scroller: HTMLDivElement | undefined

  createEffect(() => {
    const bytes = props.bytes
    setDoc(undefined)
    setSizes([])
    setFailed(false)
    if (!bytes) return
    const state = { cancelled: false, task: undefined as Awaited<ReturnType<typeof openPdf>> | undefined }
    void openPdf(bytes)
      .then(async (task) => {
        state.task = task
        const loaded = await task.promise
        if (state.cancelled) return
        const pages = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, index) =>
            loaded.getPage(index + 1).then((page) => {
              const viewport = page.getViewport({ scale: 1 })
              return { width: viewport.width, height: viewport.height }
            }),
          ),
        )
        if (state.cancelled) return
        setSizes(pages)
        setDoc(loaded)
      })
      .catch(() => !state.cancelled && setFailed(true))
    onCleanup(() => {
      state.cancelled = true
      void state.task?.destroy()
    })
  })

  const observeWidth = (element: HTMLDivElement) => {
    scroller = element
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    onCleanup(() => observer.disconnect())
  }

  // CSS width of a page: fit the pane (minus padding) at zoom 1.
  const pageWidth = () => Math.max(120, (width() - GAP * 2) * zoom())
  const step = (delta: number) => setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(value + delta).toFixed(2))))

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="pdf-pages">
      <div class="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-v2-border-border-muted px-2">
        <Show when={sizes().length > 0}>
          <span class="mr-auto text-12-regular text-v2-text-text-muted">
            {language.t("file.view.pdf.pages", { count: String(sizes().length) })}
          </span>
        </Show>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded text-14-medium text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 disabled:opacity-40"
          aria-label={language.t("file.view.pdf.zoomOut")}
          disabled={zoom() <= MIN_ZOOM}
          onClick={() => step(-0.25)}
        >
          −
        </button>
        <button
          type="button"
          class="min-w-12 rounded px-1 text-12-regular text-v2-text-text-muted hover:bg-v2-background-bg-layer-02"
          title={language.t("file.view.pdf.fitWidth")}
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom() * 100)}%
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded text-14-medium text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 disabled:opacity-40"
          aria-label={language.t("file.view.pdf.zoomIn")}
          disabled={zoom() >= MAX_ZOOM}
          onClick={() => step(0.25)}
        >
          +
        </button>
      </div>
      <div ref={observeWidth} class="min-h-0 flex-1 overflow-auto bg-v2-background-bg-layer-02" data-slot="pdf-scroller">
        <Show
          when={!failed()}
          fallback={
            <div class="flex h-full items-center justify-center p-6 text-13-regular text-v2-text-text-muted">
              {language.t("file.view.pdf.unreadable")}
            </div>
          }
        >
          <div class="flex w-max min-w-full flex-col items-center" style={{ gap: `${GAP}px`, padding: `${GAP}px` }}>
            <For each={sizes()}>
              {(size, index) => (
                <PdfPage
                  doc={doc()}
                  number={index() + 1}
                  width={pageWidth()}
                  height={(pageWidth() * size.height) / size.width}
                  root={() => scroller}
                  label={`${props.title} · ${index() + 1}`}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

function PdfPage(props: {
  doc: PDFDocumentProxy | undefined
  number: number
  width: number
  height: number
  root: () => HTMLDivElement | undefined
  label: string
}) {
  const [visible, setVisible] = createSignal(false)
  let canvas: HTMLCanvasElement | undefined
  let box: HTMLDivElement | undefined

  const observe = (element: HTMLDivElement) => {
    box = element
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      root: props.root(),
      rootMargin: "600px 0px",
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }

  createEffect(() => {
    const doc = props.doc
    const width = props.width
    if (!doc || !visible() || !canvas || !box) return
    const target = canvas
    const state = { cancelled: false, task: undefined as RenderTask | undefined }
    const timer = setTimeout(() => {
      void doc.getPage(props.number).then((page) => {
        if (state.cancelled) return
        const base = page.getViewport({ scale: 1 })
        const ratio = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: (width / base.width) * ratio })
        target.width = Math.floor(viewport.width)
        target.height = Math.floor(viewport.height)
        state.task = page.render({ canvas: target, viewport })
        return state.task.promise.catch(() => undefined)
      })
    }, 60)
    onCleanup(() => {
      state.cancelled = true
      clearTimeout(timer)
      state.task?.cancel()
    })
  })

  return (
    <div
      ref={observe}
      class="shrink-0 bg-white shadow-[var(--v2-elevation-raised)]"
      style={{ width: `${props.width}px`, height: `${props.height}px` }}
      data-slot="pdf-page"
      data-page={props.number}
    >
      <canvas ref={canvas} class="block size-full" role="img" aria-label={props.label} />
    </div>
  )
}
