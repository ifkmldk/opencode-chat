import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { SessionAssistantContent, SessionUserMessage } from "@opencode/session-ui/message"
import { readPromptPresentation } from "@/composer/comment-note"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { sessionHref } from "@/shell/routes/session"
import { mainSessionContext, SideChat, sideChatPrompt } from "./model"

const emptyModel = { id: "", providerID: "" }

// fork: Side chat pane (v1). Renders its own session's messages and a small composer; each send carries
// the main session's conversation as background so side questions share the same context.
export function SideChatPane(props: { mainSessionID: string; directory: string }) {
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const navigate = useNavigate()
  const [text, setText] = createSignal("")
  const entry = () => SideChat.for(props.mainSessionID)
  const sideID = () => entry()?.sessionID
  const main = () => data.session.get(props.mainSessionID)
  const messages = createMemo(() => {
    const id = sideID()
    return id ? data.session.message.list(id) : []
  })
  const busy = () => {
    const id = sideID()
    return !!id && data.session.status(id) === "running"
  }
  let scroller: HTMLDivElement | undefined

  createEffect(
    on(sideID, (id) => {
      if (id) void data.session.message.sync(id).catch(() => undefined)
    }),
  )
  createEffect(
    on(
      () => messages().length,
      () => queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight)),
    ),
  )

  const ensure = () => {
    const current = sideID()
    if (current) return current
    const info = main()
    const created = data.session.create({
      title: language.t("session.sideChat.title", { title: info?.title ?? "" }),
      agent: info?.agent,
      model: info?.model,
      location: { directory: props.directory },
    })
    SideChat.set(props.mainSessionID, { sessionID: created.id, directory: props.directory })
    return created.id
  }

  const send = () => {
    const value = text().trim()
    if (!value) return
    const sessionID = ensure()
    setText("")
    const context = mainSessionContext(data.session.message.list(props.mainSessionID))
    void data.session
      .prompt({ sessionID, text: sideChatPrompt(context, value), metadata: { displayText: value, comments: [] } })
      .catch(() => setText(value))
  }

  return (
    <div data-component="side-chat" class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-v2-border-border-muted px-3">
        <Icon name="bubble-5" size="small" class="text-v2-icon-icon-muted" />
        <span class="min-w-0 flex-1 truncate text-12-medium text-v2-text-text-base">
          {language.t("session.tab.sideChat")}
        </span>
        <Show when={sideID()}>
          {(id) => (
            <>
              <Tooltip placement="bottom" value={language.t("session.sideChat.openFull")}>
                <IconButton
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("session.sideChat.openFull")}
                  icon={<Icon name="square-arrow-top-right" size="small" />}
                  onClick={() => navigate(sessionHref(server.key, id()))}
                />
              </Tooltip>
              <Tooltip placement="bottom" value={language.t("session.sideChat.new")}>
                <IconButton
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("session.sideChat.new")}
                  icon={<Icon name="plus" size="small" />}
                  onClick={() => SideChat.clear(props.mainSessionID)}
                />
              </Tooltip>
            </>
          )}
        </Show>
      </div>
      <div ref={scroller} class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Show
          when={messages().length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Icon name="bubble-5" size="large" class="text-v2-icon-icon-muted" />
              <div class="text-13-medium text-v2-text-text-base">{language.t("session.sideChat.empty.title")}</div>
              <div class="text-12-regular text-v2-text-text-muted">{language.t("session.sideChat.empty.description")}</div>
            </div>
          }
        >
          <div class="flex flex-col gap-4">
            <For each={messages()}>{(message) => <SideChatMessage message={message} sessionID={sideID()!} />}</For>
            <Show when={busy()}>
              <div class="text-13-regular text-v2-text-text-muted">
                <span role="status" aria-label={language.t("session.sideChat.thinking")}>
                  <TextShimmer text="•••" active />
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <form
        class="flex shrink-0 items-end gap-2 border-t border-v2-border-border-muted p-2"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <textarea
          data-action="side-chat-input"
          value={text()}
          rows={2}
          placeholder={language.t("session.sideChat.placeholder")}
          class="min-w-0 flex-1 resize-none rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-13-regular leading-[var(--line-height-base)] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus:border-v2-border-border-focus"
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
            event.preventDefault()
            send()
          }}
        />
        <IconButton
          type="submit"
          variant="submit"
          size="large"
          disabled={!text().trim()}
          aria-label={language.t("ui.promptInput.send")}
          icon={<Icon name="arrow-up" size="small" />}
        />
      </form>
    </div>
  )
}

function SideChatMessage(props: { message: SessionMessageInfo; sessionID: string }) {
  return (
    <Show
      when={props.message.type === "assistant" ? (props.message as SessionMessageAssistant) : undefined}
      fallback={
        <Show when={props.message.type === "user" ? (props.message as SessionMessageUser) : undefined}>
          {(message) => (
            <SessionUserMessage
              sessionID={props.sessionID}
              message={message()}
              displayText={readPromptPresentation(message().metadata)?.displayText}
              historicalAgent=""
              historicalModel={emptyModel}
            />
          )}
        </Show>
      }
    >
      {(message) => (
        <div class="flex flex-col gap-2">
          <For each={message().content.filter((part) => part.type !== "reasoning")}>
            {(part, index) => (
              <SessionAssistantContent message={message()} content={part} contentID={`${message().id}:${index()}`} />
            )}
          </For>
        </div>
      )}
    </Show>
  )
}
