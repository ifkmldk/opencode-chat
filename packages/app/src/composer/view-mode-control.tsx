import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import type { ConversationViewMode } from "@/session/view-mode"

export function ComposerViewModeControl(props: {
  viewMode: { current: () => ConversationViewMode; set: (value: ConversationViewMode) => void }
}) {
  const language = useLanguage()
  const next = () => (props.viewMode.current() === "chat" ? "code" : props.viewMode.current() === "code" ? "laya" : "chat")
  const icon = () => (props.viewMode.current() === "chat" ? "comment" : props.viewMode.current() === "code" ? "code" : "sparkles")
  return (
    <Button
      data-action="composer-view-mode"
      data-mode={props.viewMode.current()}
      variant="ghost-muted"
      size="normal"
      style={{ height: "28px" }}
      aria-label={language.t("session.viewMode.choose")}
      title={language.t("session.viewMode.choose")}
      onClick={() => props.viewMode.set(next())}
    >
      <Icon name={icon()} class="size-4" />
      <span class="text-12-regular">
        {props.viewMode.current() === "chat"
          ? language.t("session.viewMode.chat")
          : props.viewMode.current() === "code"
            ? language.t("session.viewMode.code")
            : language.t("session.viewMode.laya")}
      </span>
    </Button>
  )
}
