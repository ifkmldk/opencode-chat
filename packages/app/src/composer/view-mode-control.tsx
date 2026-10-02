import { Icon } from "@opencode/ui/icon"
import { ComposerEditorSelect } from "@/composer/editor/editor"
import { useLanguage } from "@/runtime/i18n/language"
import type { ConversationViewMode } from "@/session/view-mode"

const modes = ["chat", "code", "classifier"] as const satisfies readonly ConversationViewMode[]
const icons = { chat: "comment", code: "code", classifier: "sparkles" } as const

// fork: v1-style mode picker — a dropdown with the current mode checked, not a cycle button.
export function ComposerViewModeControl(props: {
  viewMode: { current: () => ConversationViewMode; set: (value: ConversationViewMode) => void }
}) {
  const language = useLanguage()
  return (
    <div data-action="composer-view-mode" data-mode={props.viewMode.current()} class="flex">
      <ComposerEditorSelect
        title={language.t("session.viewMode.choose")}
        options={modes.map((id) => ({ id, label: language.t(`session.viewMode.${id}`) }))}
        current={props.viewMode.current()}
        currentIcon={<Icon name={icons[props.viewMode.current()]} class="size-4 shrink-0 opacity-60" />}
        onSelect={(id) => {
          const mode = modes.find((value) => value === id)
          if (mode) props.viewMode.set(mode)
        }}
      />
    </div>
  )
}
