import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"
import { useComposerState } from "@/composer/persistence"
import { useLanguage } from "@/runtime/i18n/language"
import { createBlobReference } from "@/runtime/persistence/drafts"
import { showToast } from "@/shell/notifications/toast"
import { captureRegion } from "@/fork/annotate/capture"
import { RegionSelectOverlay } from "@/fork/annotate/region-select"
import { isLoopback, useWebBrowser } from "./model"

type BridgeMessage = {
  opencodeBrowserPage?: { title: string; url: string }
  opencodeBrowserSelection?: { text: string; rect: { x: number; y: number; width: number; height: number } }
  opencodeBrowserNavigate?: { url: string; external?: boolean }
}

function ownOrigin(src: string) {
  if (!isLoopback(src)) return false
  // Same port means the app's own server under another loopback name.
  return new URL(src).port !== window.location.port
}

// fork: the web Browser pane (v1). Pages are framed through the server proxy in a sandbox without
// allow-same-origin, so the page runs as an opaque origin and cannot reach the app's storage or API.
export function WebBrowserPane(props: { id: string; visible: boolean }) {
  const language = useLanguage()
  const composer = useComposerState()
  const browser = useWebBrowser()
  const tab = () => browser.tab(props.id)
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    region: false,
    selection: undefined as { text: string; rect: DOMRect } | undefined,
  })
  const [frame, setFrame] = createSignal<HTMLIFrameElement>()
  const [content, setContent] = createSignal<HTMLDivElement>()

  createEffect(on(() => tab().url, (url) => !store.editing && setStore("address", url)))
  onMount(() => browser.resume(props.id))

  const onMessage = (event: MessageEvent) => {
    const target = frame()
    if (!target || event.source !== target.contentWindow) return
    const data = event.data as BridgeMessage
    if (data?.opencodeBrowserPage) return browser.page(props.id, data.opencodeBrowserPage)
    if (data?.opencodeBrowserNavigate) {
      const next = data.opencodeBrowserNavigate
      if (next.external) return void window.open(next.url, "_blank", "noopener,noreferrer")
      return browser.navigate(props.id, next.url)
    }
    const selection = data?.opencodeBrowserSelection
    if (!selection || store.region) return
    const bounds = target.getBoundingClientRect()
    setStore("selection", {
      text: selection.text,
      rect: new DOMRect(bounds.left + selection.rect.x, bounds.top + selection.rect.y, selection.rect.width, selection.rect.height),
    })
  }
  window.addEventListener("message", onMessage)
  onCleanup(() => window.removeEventListener("message", onMessage))

  const addSelection = (comment?: string) => {
    const selection = store.selection
    if (!selection) return
    composer.context.add({
      type: "page-text-annotation",
      sourceURL: tab().url,
      text: selection.text,
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    })
    setStore("selection", undefined)
  }

  const addRegion = async (blob: Blob, comment?: string) => {
    const reference = await createBlobReference(blob)
    composer.context.add({
      type: "media-annotation",
      surface: "browser",
      imageID: reference.id,
      blob: reference,
      mime: "image/png",
      comment,
      sourceURL: tab().url,
    })
  }

  const button = { variant: "ghost", size: "large" } as const
  return (
    <aside data-component="web-browser" class="relative flex size-full min-w-0 flex-col overflow-hidden bg-v2-background-bg-base">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-3">
        <Tooltip placement="top" value={language.t("common.goBack")}>
          <IconButton
            {...button}
            disabled={!tab().canGoBack}
            aria-label={language.t("common.goBack")}
            onClick={() => browser.back(props.id)}
            icon={<Icon name="chevron-left" size="small" class="rtl:rotate-180" />}
          />
        </Tooltip>
        <Tooltip placement="top" value={language.t("common.goForward")}>
          <IconButton
            {...button}
            disabled={!tab().canGoForward}
            aria-label={language.t("common.goForward")}
            onClick={() => browser.forward(props.id)}
            icon={<Icon name="chevron-right" size="small" class="rtl:rotate-180" />}
          />
        </Tooltip>
        <Tooltip placement="top" value={language.t("error.page.action.reload")}>
          <IconButton
            {...button}
            disabled={!tab().url}
            aria-label={language.t("error.page.action.reload")}
            onClick={() => browser.reload(props.id)}
            icon={
              <Show when={tab().loading} fallback={<Icon name="refresh" size="small" />}>
                <Loader />
              </Show>
            }
          />
        </Tooltip>
        <form
          dir="ltr"
          class="relative h-7 min-w-0 flex-1 rounded-md text-12-regular hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover"
          onSubmit={(event) => {
            event.preventDefault()
            browser.navigate(props.id, store.address)
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            data-action="web-browser-address"
            class="h-full w-full rounded-md border border-transparent bg-transparent px-2 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
            spellcheck={false}
            autocomplete="off"
            value={store.address}
            placeholder={language.t("session.browser.address.placeholder")}
            aria-label={language.t("session.browser.address")}
            onFocus={(event) => {
              setStore("editing", true)
              event.currentTarget.select()
            }}
            onBlur={() => setStore({ editing: false, address: tab().url })}
            onInput={(event) => setStore("address", event.currentTarget.value)}
          />
        </form>
        <button
          type="button"
          data-action="web-browser-region"
          aria-pressed={store.region}
          class="rounded px-2 py-1 text-12-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"
          disabled={!tab().src}
          onClick={() => setStore("region", (value) => !value)}
        >
          {language.t(store.region ? "file.view.region.cancel" : "session.browser.region.capture")}
        </button>
        <Tooltip placement="top" value={language.t("session.browser.openExternal")}>
          <IconButton
            {...button}
            disabled={!tab().url}
            aria-label={language.t("session.browser.openExternal")}
            onClick={() => window.open(tab().url, "_blank", "noopener,noreferrer")}
            icon={<Icon name="square-arrow-top-right" size="small" />}
          />
        </Tooltip>
      </div>
      <Show when={tab().error}>
        {(error) => (
          <div class="shrink-0 border-b border-v2-border-border-muted px-3 py-1.5 text-12-regular text-icon-critical-base">
            {error()}
          </div>
        )}
      </Show>
      <div ref={setContent} class="relative min-h-0 flex-1">
        <Show
          when={tab().src}
          fallback={
            <div class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak">
              <Icon name="globe" size="large" class="mb-2 shrink-0" />
              <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
                {language.t("session.browser.empty.title")}
              </div>
              <div class="text-13-regular leading-[var(--line-height-base)]">
                {language.t("session.browser.empty.description")}
              </div>
            </div>
          }
        >
          {(src) => (
            <iframe
              ref={setFrame}
              data-slot="web-browser-frame"
              class="block size-full border-0 bg-white"
              src={src()}
              title={tab().title || tab().url}
              // No allow-same-origin: the page gets an opaque origin, isolated from the app. A loopback page
              // framed directly (canvas, dev server) keeps its own origin so its storage works; it is never the
              // app's origin, which would give it the app's API.
              sandbox={
                ownOrigin(src())
                  ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-downloads"
                  : "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              }
              referrerPolicy="no-referrer"
              onLoad={() => browser.loaded(props.id)}
            />
          )}
        </Show>
        <RegionSelectOverlay
          active={store.region}
          capture={(rect) => captureRegion(content()!, rect)}
          onAnnotate={(blob, comment) => void addRegion(blob, comment)}
          onCaptureFailed={() => showToast({ title: language.t("file.view.region.captureFailed") })}
          onDone={() => setStore("region", false)}
        />
      </div>
      <Show when={props.visible && store.selection}>
        {(selection) => (
          <Portal>
            <SelectionActionBar
              rect={selection().rect}
              onQuote={() => addSelection()}
              onNote={(note) => addSelection(note)}
              onCancel={() => setStore("selection", undefined)}
            />
          </Portal>
        )}
      </Show>
    </aside>
  )
}
