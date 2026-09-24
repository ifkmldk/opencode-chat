import { For, Show } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { typeLabel } from "../components/message-file"
import { assistantArtifacts } from "./assistant-artifact-model"

export function AssistantArtifacts(props: { text: string; onOpen: (path: string) => void }) {
  const i18n = useI18n()
  const artifacts = () => assistantArtifacts(props.text)
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
                onClick={() => props.onOpen(artifact.path)}
              >
                <span data-slot="assistant-artifact-icon">
                  <FileIcon node={{ path: artifact.path, type: "file" }} />
                </span>
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
