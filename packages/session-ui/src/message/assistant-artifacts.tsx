import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { ImagePreview } from "@opencode/ui/image-preview"
import { FileIcon } from "@opencode/ui/file-icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { useDialog } from "@opencode/ui/context/dialog"
import { useMarkdown } from "../context/markdown"
import { typeLabel } from "../components/message-file"
import { assistantArtifacts } from "./assistant-artifact-model"

export function AssistantArtifacts(props: { text: string; onOpen: (path: string) => void }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const markdown = useMarkdown()
  const artifacts = () => assistantArtifacts(props.text)
  const [image] = createResource(
    () => {
      const first = artifacts().find((item) => item.kind === "image")
      return first && markdown?.readImage ? first.path : undefined
    },
    (path) => (path ? markdown?.readImage?.(path, new AbortController().signal) : Promise.resolve(undefined)),
  )
  const imagePath = createMemo(() => artifacts().find((item) => item.kind === "image")?.path)
  const [imageURL, setImageURL] = createSignal<string>()
  createEffect(() => {
    const source = image()
    if (!source) {
      setImageURL(undefined)
      return
    }
    const url = URL.createObjectURL(source)
    setImageURL(url)
    onCleanup(() => URL.revokeObjectURL(url))
  })
  const preview = () => {
    const url = imageURL()
    const first = artifacts().find((item) => item.kind === "image")
    if (!url || !first) return
    dialog.show(() => <ImagePreview src={url} alt={first.label} />)
  }
  return (
    <Show when={artifacts().length > 0}>
      <div data-component="assistant-artifacts" data-slot="assistant-artifacts">
        <For each={artifacts()}>
          {(artifact) => (
            <Tooltip placement="top" openDelay={500} value={artifact.path} class="max-w-[320px]">
              <button
                type="button"
                data-component="assistant-artifact"
                data-kind={artifact.kind}
                onClick={() => (artifact.kind === "image" && image() ? preview() : props.onOpen(artifact.path))}
              >
                <Show when={artifact.kind === "image" && image()}>
                  <img
                    data-slot="assistant-artifact-image"
                    src={imageURL()!}
                    alt={artifact.label}
                    onClick={(event) => {
                      event.stopPropagation()
                      preview()
                    }}
                  />
                </Show>
                <Show when={artifact.kind !== "image" || !image()}>
                  <span data-slot="assistant-artifact-icon">
                    <FileIcon node={{ path: artifact.path, type: "file" }} />
                  </span>
                </Show>
                <span data-slot="assistant-artifact-copy">
                  <span data-slot="assistant-artifact-title">{artifact.label}</span>
                  <span data-slot="assistant-artifact-type">
                    {typeLabel(artifact.path, "", i18n.t("ui.common.file"))}
                  </span>
                </span>
              </button>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}
