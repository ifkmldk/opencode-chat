import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n, type UiI18nKey } from "@opencode/ui/context/i18n"
import { useMarkdown } from "../context/markdown"
import { typeLabel } from "../components/message-file"
import type { AssistantArtifact, AssistantArtifactKind } from "./assistant-artifact-model"

const KIND_LABEL = {
  document: "ui.artifact.kind.document",
  spreadsheet: "ui.artifact.kind.spreadsheet",
  presentation: "ui.artifact.kind.presentation",
  image: "ui.artifact.kind.image",
  audio: "ui.artifact.kind.audio",
  video: "ui.artifact.kind.video",
  web: "ui.artifact.kind.web",
  archive: "ui.artifact.kind.archive",
  file: "ui.common.file",
} as const satisfies Record<AssistantArtifactKind, UiI18nKey>

export type AssistantArtifactsProps = {
  items: AssistantArtifact[]
  onOpen: (path: string) => void
  onDownload?: (path: string) => void
  /** Resolves the subset of paths that exist; cards for missing files are hidden. */
  exists?: (paths: string[]) => Promise<ReadonlySet<string>>
}

/** fork: Claude-style cards for the files a reply produced, shown once at the end of the turn. */
export function AssistantArtifacts(props: AssistantArtifactsProps) {
  const i18n = useI18n()
  const markdown = useMarkdown()
  // Plain signals, not createResource: a resource read during render suspends the nearest <Suspense>, which is
  // the whole session view, so scrolling an older turn with cards into view blanked the screen.
  const [present, setPresent] = createSignal<ReadonlySet<string>>()
  createEffect(() => {
    const exists = props.exists
    const paths = props.items.map((item) => item.path)
    if (!exists) return
    const state = { cancelled: false }
    void exists(paths)
      .catch(() => new Set(paths))
      .then((found) => !state.cancelled && setPresent(found))
    onCleanup(() => (state.cancelled = true))
  })
  const items = createMemo(() => {
    if (!props.exists) return props.items
    const found = present()
    return found ? props.items.filter((item) => found.has(item.path)) : []
  })
  const imagePath = createMemo(() => items().find((item) => item.kind === "image")?.path)
  const [imageURL, setImageURL] = createSignal<string>()
  createEffect(() => {
    const path = imagePath()
    const read = markdown?.readImage
    setImageURL(undefined)
    if (!path || !read) return
    const controller = new AbortController()
    const state = { url: undefined as string | undefined }
    void read(path, controller.signal)
      .then((source) => {
        if (controller.signal.aborted || !source) return
        state.url = URL.createObjectURL(source)
        setImageURL(state.url)
      })
      .catch(() => undefined)
    onCleanup(() => {
      controller.abort()
      if (state.url) URL.revokeObjectURL(state.url)
    })
  })
  const subtitle = (item: AssistantArtifact) => {
    const kind = i18n.t(KIND_LABEL[item.kind])
    const type = typeLabel(item.path, "", "")
    return type ? i18n.t("ui.artifact.subtitle", { kind, type }) : kind
  }
  return (
    <Show when={items().length > 0}>
      <div data-component="assistant-artifacts" data-slot="assistant-artifacts">
        <For each={items()}>
          {(item) => (
            <div data-component="assistant-artifact" data-kind={item.kind}>
              <Tooltip placement="top" openDelay={500} value={item.path} contentClass="max-w-[320px] break-all">
                <button type="button" data-slot="assistant-artifact-open" onClick={() => props.onOpen(item.path)}>
                  <span data-slot="assistant-artifact-icon">
                    <Show
                      when={item.path === imagePath() && imageURL()}
                      fallback={<FileIcon node={{ path: item.path, type: "file" }} />}
                    >
                      {(url) => <img data-slot="assistant-artifact-image" src={url()} alt="" />}
                    </Show>
                  </span>
                  <span data-slot="assistant-artifact-copy">
                    <span data-slot="assistant-artifact-title">{item.name}</span>
                    <span data-slot="assistant-artifact-type">{subtitle(item)}</span>
                  </span>
                </button>
              </Tooltip>
              <Show when={props.onDownload}>
                {(download) => (
                  <button
                    type="button"
                    data-slot="assistant-artifact-download"
                    aria-label={i18n.t("ui.artifact.downloadLabel", { name: item.name })}
                    onClick={() => download()(item.path)}
                  >
                    <Icon name="download" size="small" />
                    <span>{i18n.t("ui.artifact.downloadAction")}</span>
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
