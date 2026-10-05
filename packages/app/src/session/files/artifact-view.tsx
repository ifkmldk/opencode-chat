import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"
import { CLEAR_MESSAGE, injectSelectionBridge, readSelectionMessage, sourceLines } from "@/fork/annotate/html-bridge"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode/ui/tabs"
import { sanitizeMarkdown } from "@opencode/session-ui/markdown-cache"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { FileIcon } from "@opencode/ui/file-icon"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { getDirectory, getFilename } from "@opencode/util/path"
import type { FileContent } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import {
  artifactKind,
  blobUrlFromContent,
  contentBytes,
  officeBytes,
  parseOfficeDocument,
  parseOfficeSlides,
  parseOfficeWorkbook,
  parseDelimited,
  resolveArtifactPath,
  type ArtifactKind,
} from "@/workspaces/files/artifact"
import { extractPdfText } from "@/workspaces/files/pdf-text"
import { PdfPages } from "@/fork/pdf/pdf-pages"
import { fromBase64, toBase64 } from "@/fork/pdf/base64"
import { useServerSDK } from "@/runtime/server/client"
import { useArtifactOpener } from "@/session/files/open-artifact"
import { showToast } from "@/shell/notifications/toast"
import { captureRegion } from "@/fork/annotate/capture"
import { RegionSelectOverlay } from "@/fork/annotate/region-select"
import { TextSelectOverlay } from "@/fork/annotate/text-select"
import "./artifact-view.css"

type ArtifactMode = "preview" | "source"

/** Facts a viewer learns from the decoded media, shown in the toolbar. */
type ArtifactInfo = { width?: number; height?: number; duration?: number; rows?: number; columns?: number }

type MediaProps = {
  path: string
  content: FileContent
  onInfo: (info: ArtifactInfo) => void
  /** The browser could not decode the bytes; the host falls back to the binary placeholder. */
  onError: () => void
}

/** Kinds that render a preview from their text and can toggle back to highlighted source. */
const previewableKinds = new Set<ArtifactKind>(["svg", "html", "markdown", "mermaid", "table"])

/**
 * Renders a loaded non-text file: media, documents, and data get a dedicated viewer with a toolbar;
 * previewable text kinds can switch to `source`, which the host supplies (its code view).
 */
export type ArtifactAnnotation =
  | { kind: "text"; text: string; html?: string; lines?: string; comment?: string }
  | { kind: "media"; blob: Blob; mime: string; comment?: string }

export function ArtifactView(props: { path: string; content: FileContent; cacheKey?: string; source: JSX.Element; onAnnotate?: (annotation: ArtifactAnnotation) => void }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    mode: "preview" as ArtifactMode,
    info: {} as ArtifactInfo,
    // Media the browser could not decode falls back to the binary placeholder.
    undecodable: false,
    // fork: region-select mode for the v1 annotator.
    region: false,
  })
  createEffect(
    on(
      () => props.content,
      () => setState({ mode: "preview", info: {}, undecodable: false, region: false }),
      { defer: true },
    ),
  )

  const kind = createMemo<ArtifactKind | "binary">(() => {
    if (props.content.type === "binary" && !props.content.mimeType) return "binary"
    if (state.undecodable) return "binary"
    return artifactKind(props.path)
  })
  const previewable = createMemo(() => {
    const value = kind()
    return value !== "binary" && previewableKinds.has(value)
  })
  const meta = createMemo(() => {
    const info = state.info
    return [
      info.width && info.height ? `${info.width} × ${info.height}` : undefined,
      info.duration ? formatDuration(info.duration) : undefined,
      info.rows !== undefined ? language.plural("file.view.table.rows", Math.max(0, info.rows - 1)) : undefined,
      info.columns !== undefined ? language.plural("file.view.table.columns", info.columns) : undefined,
      formatBytes(language.intl(), contentBytes(props.content)),
    ].filter((item): item is string => !!item)
  })

  const media = { onInfo: (info: ArtifactInfo) => setState("info", info), onError: () => setState("undecodable", true) }
  const rendered = () => (
    <ScrollView class="min-h-0 flex-1">
      <Show
        when={kind() === "markdown"}
        fallback={<ArtifactMermaid text={props.content.content} cacheKey={props.cacheKey} />}
      >
        <ArtifactMarkdown path={props.path} text={props.content.content} cacheKey={props.cacheKey} />
      </Show>
    </ScrollView>
  )

  const [content, setContent] = createSignal<HTMLDivElement>()
  const actions = (
    <Show when={props.onAnnotate}>
      <Show when={kind() !== "binary" && kind() !== "font" && kind() !== "audio"}>
        <Button
          size="small"
          variant="ghost"
          data-action="artifact-select-region"
          aria-pressed={state.region}
          title={language.t("file.view.region.hint")}
          onClick={() => setState("region", (value) => !value)}
        >
          {language.t(state.region ? "file.view.region.cancel" : "file.view.region.select")}
        </Button>
      </Show>
      <Show when={kind() === "pdf"}>
        <ArtifactPdfExtractButton path={props.path} content={props.content} onAnnotate={props.onAnnotate!} />
      </Show>
    </Show>
  )
  return (
    <>
      <ArtifactToolbar
        mode={state.mode}
        onModeChange={previewable() ? (mode) => setState("mode", mode) : undefined}
        meta={meta()}
        actions={
          <>
            <Show when={kind() === "html"}>
              <OpenInBrowserButton path={props.path} />
            </Show>
            {actions}
          </>
        }
      />
      <div ref={setContent} data-slot="artifact-view-content" class="relative flex min-h-0 flex-1 flex-col">
      <Show when={!previewable() || state.mode === "preview"} fallback={props.source}>
        <Switch>
          <Match when={kind() === "image" || kind() === "svg"}>
            <ArtifactImage path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "video"}>
            <ArtifactVideo path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "audio"}>
            <ArtifactAudio path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "pdf"}>
            {/* fork: pdf.js canvases; Chromium's viewer renders nothing in the app's blob frames. */}
            <PdfPages bytes={officeBytes(props.content)} title={getFilename(props.path)} />
          </Match>
          <Match when={kind() === "html"}>
            <ArtifactFrame path={props.path} content={props.content} kind="html" onAnnotate={props.onAnnotate} />
          </Match>
          <Match when={kind() === "font"}>
            <ArtifactFont path={props.path} content={props.content} />
          </Match>
          <Match when={kind() === "table"}>
            <ArtifactTable path={props.path} text={props.content.content} onInfo={media.onInfo} />
          </Match>
          <Match when={kind() === "document" || kind() === "spreadsheet" || kind() === "presentation"}>
            <ArtifactOffice path={props.path} content={props.content} onInfo={media.onInfo} />
          </Match>
          <Match when={kind() === "markdown" || kind() === "mermaid"}>{rendered()}</Match>
          <Match when={kind() === "binary"}>
            <ArtifactBinary path={props.path} size={formatBytes(language.intl(), contentBytes(props.content))} />
          </Match>
        </Switch>
      </Show>
      <Show when={props.onAnnotate}>
        {(onAnnotate) => (
          <>
            <RegionSelectOverlay
              active={state.region}
              capture={(rect) => captureRegion(content()!, rect)}
              onAnnotate={(blob, comment) => onAnnotate()({ kind: "media", blob, mime: "image/png", comment })}
              onCaptureFailed={() => showToast({ title: language.t("file.view.region.captureFailed") })}
              onDone={() => setState("region", false)}
            />
            <Show when={!state.region}>
              <TextSelectOverlay
                container={content}
                onAnnotate={(item, comment) => onAnnotate()({ kind: "text", text: item.text, html: item.html, comment })}
              />
            </Show>
          </>
        )}
      </Show>
      </div>
    </>
  )
}

function formatBytes(locale: string, bytes: number) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const
  const index = Math.min(units.length - 1, bytes > 0 ? Math.floor(Math.log10(bytes) / 3) : 0)
  const value = bytes / 1000 ** index
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[index],
    // "short" bytes render as the singular "byte"; the long form pluralizes correctly.
    unitDisplay: index === 0 ? "long" : "short",
    maximumFractionDigits: value >= 100 || index === 0 ? 0 : 1,
  }).format(value)
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

function ArtifactToolbar(props: {
  mode?: ArtifactMode
  onModeChange?: (mode: ArtifactMode) => void
  meta: string[]
  actions?: JSX.Element
}) {
  const language = useLanguage()
  return (
    <div data-slot="artifact-toolbar" class="flex h-10 shrink-0 items-center gap-3 px-4">
      <Show when={props.onModeChange}>
        <SegmentedControl
          value={props.mode ?? "preview"}
          onChange={(value) => {
            if (value === "preview" || value === "source") props.onModeChange?.(value)
          }}
        >
          <SegmentedControlItem value="preview">{language.t("file.view.preview")}</SegmentedControlItem>
          <SegmentedControlItem value="source">{language.t("file.view.source")}</SegmentedControlItem>
        </SegmentedControl>
      </Show>
      <div class="ms-auto flex min-w-0 items-center gap-3">
        <div class="flex min-w-0 items-center gap-2 text-12-regular text-text-weak">
          <For each={props.meta}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden class="text-text-weaker">
                    ·
                  </span>
                </Show>
                <span class="truncate tabular-nums">{item}</span>
              </>
            )}
          </For>
        </div>
        {props.actions}
      </div>
    </div>
  )
}

function OpenInBrowserButton(props: { path: string }) {
  const language = useLanguage()
  const artifacts = useArtifactOpener()
  return (
    <Show when={artifacts.canOpenInBrowser(props.path)}>
      <Button size="small" variant="ghost" icon="globe" onClick={() => artifacts.openInBrowser(props.path)}>
        {language.t("file.view.openInBrowser")}
      </Button>
    </Show>
  )
}

function createBlobUrl(content: () => FileContent) {
  return createMemo(() => {
    const value = blobUrlFromContent(content())
    onCleanup(() => URL.revokeObjectURL(value))
    return value
  })
}

/** Images and SVG previews: fit the pane, click to inspect at 1:1 when the image is larger. */
function ArtifactImage(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  const [state, setState] = createStore({ zoom: "fit" as "fit" | "actual", overflow: false, width: 0, height: 0 })
  let stage: HTMLDivElement | undefined
  const measure = () => {
    if (!stage) return
    setState("overflow", state.width > stage.clientWidth - 48 || state.height > stage.clientHeight - 48)
  }
  createResizeObserver(
    () => stage,
    () => measure(),
  )
  createEffect(() => {
    url()
    setState({ zoom: "fit", overflow: false })
  })
  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-checker
      data-zoom={state.zoom}
      data-overflow={state.overflow || undefined}
      class="relative min-h-0 flex-1 overflow-auto"
    >
      <div
        classList={{
          "absolute inset-0 flex items-center justify-center p-6": state.zoom === "fit",
          "flex min-h-full min-w-full w-max items-center justify-center p-6": state.zoom === "actual",
        }}
      >
        <img
          data-slot="artifact-media"
          src={url()}
          alt={getFilename(props.path)}
          draggable={false}
          onError={() => props.onError()}
          onLoad={(event) => {
            const image = event.currentTarget
            setState({ width: image.naturalWidth, height: image.naturalHeight })
            props.onInfo({ width: image.naturalWidth, height: image.naturalHeight })
            measure()
          }}
          onClick={() => {
            if (!state.overflow && state.zoom === "fit") return
            setState("zoom", state.zoom === "fit" ? "actual" : "fit")
          }}
        />
      </div>
    </div>
  )
}

function ArtifactVideo(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  return (
    <div data-slot="artifact-stage" data-zoom="fit" class="relative min-h-0 flex-1 overflow-hidden">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <video
          data-slot="artifact-media"
          class="w-full bg-black"
          controls
          preload="metadata"
          playsinline
          onError={() => props.onError()}
          src={url()}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            props.onInfo({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
          }}
        />
      </div>
    </div>
  )
}

function ArtifactAudio(props: MediaProps) {
  const url = createBlobUrl(() => props.content)
  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="flex w-full max-w-lg flex-col items-center gap-5 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base px-8 py-8 shadow-[var(--v2-elevation-raised)]">
          <div class="flex size-14 items-center justify-center rounded-full bg-v2-background-bg-layer-02">
            <FileIcon node={{ path: props.path, type: "file" }} class="size-7" />
          </div>
          <div class="max-w-full truncate text-14-medium text-text-strong">{getFilename(props.path)}</div>
          <audio
            class="w-full"
            onError={() => props.onError()}
            controls
            preload="metadata"
            src={url()}
            onLoadedMetadata={(event) => props.onInfo({ duration: event.currentTarget.duration })}
          />
        </div>
      </div>
    </div>
  )
}

// Mirrors BROWSER_PROXY_TOKEN_HEADER in @opencode/protocol (the app depends on the client, not protocol).
const PREVIEW_TOKEN_HEADER = "x-opencode-ticket"

function ArtifactFrame(props: {
  path: string
  content: FileContent
  kind: "pdf" | "html"
  onAnnotate?: (annotation: ArtifactAnnotation) => void
}) {
  // fork: HTML previews are staged on the server and framed from there: the app's CSP blocks inline and CDN
  // scripts in blob: frames, so a generated page with JavaScript did not run. They also get a selection bridge
  // (fork/annotate/html-bridge.ts) so text can be quoted or noted, with the source lines it came from.
  const sdk = useServerSDK()
  const staged = () => props.kind === "html" && props.content.encoding !== "base64"
  const [stagedSrc, setStagedSrc] = createSignal<string>()
  createEffect(() => {
    if (!staged()) return setStagedSrc(undefined)
    const html = props.onAnnotate ? injectSelectionBridge(props.content.content) : props.content.content
    const state = { cancelled: false }
    setStagedSrc(undefined)
    void sdk.api.browserProxy
      .preview({ html, [PREVIEW_TOKEN_HEADER]: "1" })
      .then((result) => {
        if (state.cancelled) return
        const page = new URL("/api/experimental/browser-proxy/preview", sdk.url)
        page.searchParams.set("ticket", result.ticket)
        setStagedSrc(page.toString())
      })
      .catch(() => undefined)
    onCleanup(() => (state.cancelled = true))
  })
  // The blob URL is the fallback while staging is pending or when it fails (and for PDFs).
  const blob = createMemo(() => {
    const value = blobUrlFromContent(props.content)
    onCleanup(() => URL.revokeObjectURL(value))
    return value
  })
  const url = () => (staged() ? (stagedSrc() ?? blob()) : blob())
  // PDF Open Parameters: start with the thumbnail pane closed and the page fitted to the pane width.
  const src = () => (props.kind === "pdf" ? `${url()}#navpanes=0&view=FitH` : url())
  let frame: HTMLIFrameElement | undefined
  const [selection, setSelection] = createSignal<{ text: string; html?: string; rect: DOMRect }>()
  const clear = () => {
    setSelection(undefined)
    frame?.contentWindow?.postMessage({ [CLEAR_MESSAGE]: true }, "*")
  }
  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return
      const value = readSelectionMessage(event.data)
      if (value === undefined) return
      if (value === null) return setSelection(undefined)
      const bounds = frame.getBoundingClientRect()
      setSelection({
        text: value.text,
        html: value.html,
        rect: new DOMRect(bounds.left + value.rect.x, bounds.top + value.rect.y, value.rect.width, value.rect.height),
      })
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })
  const submit = (comment?: string) => {
    const current = selection()
    if (!current || !props.onAnnotate) return
    const range = sourceLines(props.content.content, current.text)
    props.onAnnotate({
      kind: "text",
      text: current.text,
      html: current.html,
      lines: range ? (range.start === range.end ? String(range.start) : `${range.start}-${range.end}`) : undefined,
      comment,
    })
    clear()
  }
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <iframe
        ref={frame}
        class="block h-full w-full flex-1 border-0 bg-white"
        title={getFilename(props.path)}
        src={src()}
        // The PDF viewer is Chromium's own and does not run in a sandboxed frame. HTML runs as an
        // opaque origin: no app storage, cookies, or credentialed requests reach it.
        sandbox={props.kind === "html" ? "allow-scripts allow-popups allow-forms allow-modals" : undefined}
        referrerPolicy="no-referrer"
      />
      <Show when={selection()}>
        {(current) => (
          <Portal>
            <SelectionActionBar
              rect={current().rect}
              preview={current().text}
              onQuote={() => submit()}
              onNote={(text) => submit(text)}
              onCancel={clear}
            />
          </Portal>
        )}
      </Show>
    </div>
  )
}

/**
 * PDF text bridge: Chromium renders the pixels but gives no selectable text back to the app, so the
 * embedded text is extracted with pdf.js on demand. Scanned PDFs have none and say so instead of
 * silently sending nothing.
 */
function ArtifactPdfExtractButton(props: {
  path: string
  content: FileContent
  onAnnotate: (annotation: ArtifactAnnotation) => void
}) {
  const language = useLanguage()
  const [pending, setPending] = createSignal(false)
  const send = async () => {
    const data = officeBytes(props.content)
    if (!data || pending()) return
    setPending(true)
    const result = await extractPdfText(data).catch(() => undefined)
    setPending(false)
    if (!result) return showToast({ title: language.t("file.view.pdf.extractUnavailable") })
    const text = result.text.trim()
    if (!text) return showToast({ title: language.t("file.view.pdf.scanned") })
    props.onAnnotate({
      kind: "text",
      text,
      comment: language.t(result.truncated ? "file.view.pdf.sourceTruncated" : "file.view.pdf.source", {
        name: getFilename(props.path),
      }),
    })
  }
  return (
    <Button
      size="small"
      variant="ghost"
      data-action="pdf-send-to-chat"
      title={language.t("file.view.pdf.sendToChatHint")}
      disabled={pending()}
      onClick={() => void send()}
    >
      {language.t("file.view.pdf.sendToChat")}
    </Button>
  )
}

function ArtifactMarkdown(props: { path: string; text: string; cacheKey?: string }) {
  const parent = useMarkdown()
  const artifacts = useArtifactOpener()
  // getDirectory yields "/" for a root-level file, which would make relative links absolute.
  const dir = createMemo(() => (props.path.includes("/") || props.path.includes("\\") ? getDirectory(props.path) : ""))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))
  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => artifacts.open(href, dir())}
    >
      <div class="mx-auto w-full max-w-3xl px-8 py-6">
        <Markdown text={props.text} cacheKey={props.cacheKey} class="select-text" />
      </div>
    </MarkdownProvider>
  )
}

/** Mermaid sources render through the same fenced-block pipeline the timeline uses. */
function ArtifactMermaid(props: { text: string; cacheKey?: string }) {
  return (
    <div class="mx-auto w-full max-w-4xl px-8 py-6">
      <Markdown text={`\`\`\`mermaid\n${props.text}\n\`\`\``} cacheKey={props.cacheKey} class="select-text" />
    </div>
  )
}

function ArtifactTable(props: { path: string; text: string; onInfo: (info: ArtifactInfo) => void }) {
  const language = useLanguage()
  const parsed = createMemo(() => parseDelimited(props.text, props.path.toLowerCase().endsWith(".tsv") ? "\t" : ","))
  createEffect(() => props.onInfo({ rows: parsed().total, columns: parsed().columns }))
  // Pad the header to the widest row so no data column is dropped.
  const header = () => Array.from({ length: parsed().columns }, (_, index) => parsed().rows[0]?.[index] ?? "")
  const body = () => parsed().rows.slice(1)
  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <table data-slot="artifact-table" class="min-w-full text-13-regular text-text-base">
        <thead>
          <tr>
            <th data-index />
            <For each={header()}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={body()}>
            {(row, index) => (
              <tr>
                <td data-index>{index() + 1}</td>
                <For each={header()}>{(_, column) => <td>{row[column()] ?? ""}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={parsed().total > parsed().rows.length}>
        <div class="px-4 py-3 text-12-regular text-text-weak">
          {language.t("file.view.table.truncated", { shown: parsed().rows.length - 1, total: parsed().total - 1 })}
        </div>
      </Show>
    </div>
  )
}

function OfficeState(props: { loading: boolean; error?: unknown }) {
  const language = useLanguage()
  return (
    <Show when={props.loading || !!props.error}>
      <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
        {props.error ? language.t("file.view.office.unavailable") : language.t("file.view.office.loading")}
      </div>
    </Show>
  )
}

function OfficeTable(props: { rows: unknown[][] }) {
  const header = () => Array.from({ length: Math.max(0, ...props.rows.map((row) => row.length)) }, (_, index) => props.rows[0]?.[index] ?? "")
  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <table data-slot="artifact-table" class="min-w-full text-13-regular text-text-base">
        <thead><tr><th data-index /><For each={header()}>{(cell) => <th>{String(cell)}</th>}</For></tr></thead>
        <tbody>
          <For each={props.rows.slice(1)}>
            {(row, index) => <tr><td data-index>{index() + 1}</td><For each={header()}>{(_, column) => <td>{String(row[column()] ?? "")}</td>}</For></tr>}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function ArtifactOfficeQuick(props: { path: string; content: FileContent; onInfo: (info: ArtifactInfo) => void }) {
  const bytes = () => officeBytes(props.content)
  const type = () => artifactKind(props.path)
  const [workbookResource] = createResource(() => (type() === "spreadsheet" ? bytes() : undefined), parseOfficeWorkbook)
  const [documentResource] = createResource(() => (type() === "document" ? bytes() : undefined), parseOfficeDocument)
  const [slidesResource] = createResource(() => (type() === "presentation" ? bytes() : undefined), parseOfficeSlides)
  // fork: reading an errored resource throws, and that blanked the whole side panel (a .pptx did it when its parser
  // failed). A failed parse now falls through to the "unavailable" state instead.
  const settled = <T,>(resource: { (): T | undefined; error?: unknown }) => (resource.error ? undefined : resource())
  const workbook = Object.assign(() => settled(workbookResource), {
    get loading() {
      return workbookResource.loading
    },
    get error() {
      return workbookResource.error as unknown
    },
  })
  const document = Object.assign(() => settled(documentResource), {
    get loading() {
      return documentResource.loading
    },
    get error() {
      return documentResource.error as unknown
    },
  })
  const slides = Object.assign(() => settled(slidesResource), {
    get loading() {
      return slidesResource.loading
    },
    get error() {
      return slidesResource.error as unknown
    },
  })
  createEffect(() => {
    if (workbook()) props.onInfo({ rows: workbook()?.reduce((max, sheet) => Math.max(max, sheet.rows.length), 0), columns: 0 })
    if (slides()) props.onInfo({ rows: slides()?.length })
  })
  return (
    <Switch>
      <Match when={type() === "spreadsheet"}>
        <Show
          when={workbook()}
          fallback={<OfficeState loading={workbook.loading} error={workbook.error} />}
        >
          {(sheets) => (
            <Show when={sheets().length > 1} fallback={<OfficeTable rows={sheets()[0]!.rows} />}>
              <Tabs defaultValue={sheets()[0]!.name} variant="line" class="min-h-0 flex-1 flex-col">
                <Tabs.List><For each={sheets()}>{(sheet) => <Tabs.Trigger value={sheet.name}>{sheet.name}</Tabs.Trigger>}</For></Tabs.List>
                <For each={sheets()}>{(sheet) => <Tabs.Content value={sheet.name} class="min-h-0 flex-1"><OfficeTable rows={sheet.rows} /></Tabs.Content>}</For>
              </Tabs>
            </Show>
          )}
        </Show>
      </Match>
      <Match when={type() === "document"}>
        <Show
          when={document()}
          fallback={<OfficeState loading={document.loading} error={document.error} />}
        >
          {(html) => <div data-slot="artifact-office-document" class="min-h-0 flex-1 overflow-auto px-8 py-6" innerHTML={sanitizeMarkdown(html())} />}
        </Show>
      </Match>
      <Match when={type() === "presentation"}>
        <Show
          when={slides()}
          fallback={<OfficeState loading={slides.loading} error={slides.error} />}
        >
          {(items) => <ArtifactSlides bytes={bytes()} slides={items()} />}
        </Show>
      </Match>
    </Switch>
  )
}

/**
 * fork: Word, PowerPoint and Excel files open as the exact pages Office draws. The server converts the file to PDF with
 * the Office or LibreOffice on its host and pdf.js shows it; until that arrives (or when no engine exists) the quick
 * client-side view stays on screen.
 */
function ArtifactOffice(props: { path: string; content: FileContent; onInfo: (info: ArtifactInfo) => void }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [exact, setExact] = createSignal<{ state: "loading" | "failed" } | { state: "ready"; pdf: Uint8Array }>({ state: "loading" })
  const [mode, setMode] = createSignal<"exact" | "quick">("exact")
  createEffect(() => {
    const bytes = officeBytes(props.content)
    setExact({ state: "loading" })
    if (!bytes) return setExact({ state: "failed" })
    const state = { cancelled: false }
    void sdk.api.office
      .preview({ name: getFilename(props.path), data: toBase64(bytes) })
      .then((result) => !state.cancelled && setExact({ state: "ready", pdf: fromBase64(result.pdf) }))
      .catch(() => !state.cancelled && setExact({ state: "failed" }))
    onCleanup(() => (state.cancelled = true))
  })
  const ready = () => {
    const value = exact()
    return value.state === "ready" && mode() === "exact" ? value.pdf : undefined
  }
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show when={exact().state !== "failed"}>
        <div class="flex shrink-0 items-center justify-end gap-3 border-b border-border-weaker-base px-4 py-2">
          <Show when={exact().state === "loading"}>
            <span class="text-12-regular text-text-weak" data-slot="office-exact-status">
              {language.t("file.view.office.rendering")}
            </span>
          </Show>
          <Show when={exact().state === "ready"}>
            <SegmentedControl
              value={mode()}
              onChange={(value) => {
                if (value === "exact" || value === "quick") setMode(value)
              }}
            >
              <SegmentedControlItem value="exact">{language.t("file.view.office.exact")}</SegmentedControlItem>
              <SegmentedControlItem value="quick">{language.t("file.view.office.quick")}</SegmentedControlItem>
            </SegmentedControl>
          </Show>
        </div>
      </Show>
      <Show
        when={ready()}
        fallback={<ArtifactOfficeQuick path={props.path} content={props.content} onInfo={props.onInfo} />}
      >
        {(pdf) => <PdfPages bytes={pdf()} title={getFilename(props.path)} />}
      </Show>
    </div>
  )
}

type SlideOutline = { index: number; title?: string; bullets: string[] }

/**
 * Presentations open as real visual slides rendered client-side; the extracted outline stays
 * available from the Text toggle, and a renderer failure drops back to it automatically.
 */
function ArtifactSlides(props: { bytes?: Uint8Array; slides: SlideOutline[] }) {
  const language = useLanguage()
  const [mode, setMode] = createSignal<"visual" | "text">("visual")
  const [visual, setVisual] = createSignal<"loading" | "ready">("loading")
  let host: HTMLDivElement | undefined
  let active: (() => void) | undefined
  onCleanup(() => active?.())

  createEffect(
    on(
      () => (mode() === "visual" ? props.bytes : undefined),
      (bytes) => {
        active?.()
        active = undefined
        const el = host
        if (!bytes || !el) return
        let cancelled = false
        let previewer: { destroy?: () => void } | undefined
        setVisual("loading")
        el.innerHTML = ""
        active = () => {
          cancelled = true
          previewer?.destroy?.()
          if (el) el.innerHTML = ""
        }
        void (async () => {
          try {
            const { init } = await import("pptx-preview")
            const target = host
            if (cancelled || !target) return
            const width = Math.max(560, Math.min(1120, Math.floor(target.clientWidth || 960)))
            const instance = init(target, { width, height: Math.round((width * 9) / 16) })
            if (cancelled) {
              instance.destroy?.()
              return
            }
            previewer = instance
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
            await instance.preview(buffer)
            if (!cancelled) setVisual("ready")
          } catch {
            // The visual renderer is best-effort; the outline below is the durable path.
            if (cancelled) return
            setMode("text")
          }
        })()
      },
    ),
  )

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center justify-end border-b border-border-weaker-base px-4 py-2">
        <SegmentedControl
          value={mode()}
          onChange={(value) => {
            if (value === "visual" || value === "text") setMode(value)
          }}
        >
          <SegmentedControlItem value="visual">{language.t("file.view.slides.visual")}</SegmentedControlItem>
          <SegmentedControlItem value="text">{language.t("file.view.slides.text")}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <Show
        when={mode() === "visual" && props.bytes}
        fallback={
          <div class="min-h-0 flex-1 overflow-auto p-6">
            <Show when={!props.bytes && mode() === "visual"}>
              <div class="mb-4 text-13-regular text-text-weak">{language.t("file.view.slides.tooLarge")}</div>
            </Show>
            <For each={props.slides}>
              {(slide) => (
                <section class="mb-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base p-5">
                  <h2 class="mb-2 text-15-semibold text-text-strong">
                    {slide.title
                      ? language.t("file.view.slides.titled", { index: slide.index, title: slide.title })
                      : language.t("file.view.slides.slide", { index: slide.index })}
                  </h2>
                  <For each={slide.bullets}>{(bullet) => <p class="text-13-regular text-text-base">• {bullet}</p>}</For>
                </section>
              )}
            </For>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-auto p-6">
          <div ref={(el) => (host = el)} data-slot="artifact-slides-visual" class="mx-auto flex w-full max-w-5xl flex-col items-center" />
          <Show when={visual() === "loading"}>
            <div class="mt-3 text-13-regular text-text-weak">{language.t("file.view.slides.rendering")}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const specimenSizes = [12, 16, 24, 40, 64]

function ArtifactFont(props: { path: string; content: FileContent }) {
  const language = useLanguage()
  const url = createBlobUrl(() => props.content)
  const family = createMemo(() => `artifact-${Math.random().toString(36).slice(2)}`)
  createEffect(() => {
    const face = new FontFace(family(), `url(${url()})`)
    document.fonts.add(face)
    void face.load().catch(() => undefined)
    onCleanup(() => document.fonts.delete(face))
  })
  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8" style={{ "font-family": `"${family()}"` }}>
        <div class="text-text-strong" style={{ "font-size": "56px", "line-height": "1.1" }}>
          {getFilename(props.path).replace(/\.[^.]+$/, "")}
        </div>
        <div class="break-all text-text-base" style={{ "font-size": "22px", "line-height": "1.4" }}>
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
          <br />
          abcdefghijklmnopqrstuvwxyz
          <br />
          0123456789 !?&@#%(){}[]
        </div>
        <div class="flex flex-col gap-3 border-t border-v2-border-border-muted pt-6">
          <For each={specimenSizes}>
            {(size) => (
              <div class="flex items-baseline gap-4">
                <span
                  class="w-8 shrink-0 text-12-regular text-text-weaker tabular-nums"
                  style={{ "font-family": "var(--font-family-mono)" }}
                >
                  {size}
                </span>
                <span class="text-text-base" style={{ "font-size": `${size}px`, "line-height": "1.25" }}>
                  {language.t("file.view.fontSample")}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function ArtifactBinary(props: { path: string; size: string }) {
  const language = useLanguage()
  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileIcon node={{ path: props.path, type: "file" }} class="size-8 text-text-weak" />
        <div class="text-14-medium text-text-strong">{getFilename(props.path)}</div>
        <div class="text-13-regular text-text-weak">{language.t("file.view.binary", { size: props.size })}</div>
      </div>
    </div>
  )
}
