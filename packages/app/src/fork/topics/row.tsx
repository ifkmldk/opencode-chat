import { createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { Topics, type Topic } from "./model"

// fork: Topics chip row on Home (v1). Selecting a chip filters the session list; the chip's + starts a
// new session inside that topic.
export function HomeTopicsRow(props: { canCreateSession: boolean; onCreateSession: () => void }) {
  const language = useLanguage()
  const [adding, setAdding] = createSignal(false)
  return (
    <div data-component="home-topics" class="flex w-full flex-wrap items-center gap-1.5 pe-[120px] pt-3">
      <For each={Topics.list()}>
        {(topic) => (
          <TopicChip
            topic={topic}
            active={Topics.selected() === topic.id}
            canCreateSession={props.canCreateSession}
            onCreateSession={() => {
              Topics.select(topic.id)
              props.onCreateSession()
            }}
          />
        )}
      </For>
      <Show
        when={adding()}
        fallback={
          <button
            type="button"
            data-action="home-topic-add"
            class="flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-v2-border-border-muted px-2.5 text-[12px] leading-4 text-v2-text-text-muted [font-weight:530] transition-colors duration-[120ms] hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size="small" />
            {language.t("home.topics.add")}
          </button>
        }
      >
        <TopicNameInput
          placeholder={language.t("home.topics.namePlaceholder")}
          onSubmit={(name) => {
            if (name.trim()) Topics.create(name)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      </Show>
    </div>
  )
}

function TopicNameInput(props: {
  initial?: string
  placeholder?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const state = { settled: false }
  return (
    <input
      ref={(element) => queueMicrotask(() => element.focus())}
      type="text"
      value={props.initial ?? ""}
      placeholder={props.placeholder}
      class="h-7 w-36 rounded-full border border-v2-border-border-focus bg-v2-background-bg-layer-02 px-2.5 text-[12px] leading-4 text-v2-text-text-base outline-none [font-weight:530] placeholder:text-v2-text-text-faint"
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return
        event.preventDefault()
        state.settled = true
        if (event.key === "Enter") props.onSubmit(event.currentTarget.value)
        else props.onCancel()
      }}
      onBlur={(event) => {
        if (state.settled) return
        state.settled = true
        props.onSubmit(event.currentTarget.value)
      }}
    />
  )
}

function TopicChip(props: { topic: Topic; active: boolean; canCreateSession: boolean; onCreateSession: () => void }) {
  const language = useLanguage()
  const [editing, setEditing] = createSignal(false)
  const action =
    "flex size-4 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity duration-[120ms] group-hover/topic:opacity-100 focus-visible:opacity-100"
  return (
    <Show
      when={!editing()}
      fallback={
        <TopicNameInput
          initial={props.topic.name}
          onSubmit={(name) => {
            Topics.rename(props.topic.id, name)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      }
    >
      <div
        data-component="home-topic"
        data-active={props.active}
        class="group/topic flex h-7 shrink-0 items-center gap-1 rounded-full border ps-2.5 pe-1.5 text-[12px] leading-4 [font-weight:530] transition-colors duration-[120ms]"
        classList={{
          "border-transparent bg-v2-background-bg-layer-03 text-v2-text-text-base": props.active,
          "border-v2-border-border-muted text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": !props.active,
        }}
      >
        <button
          type="button"
          data-action="home-topic-select"
          title={language.t("home.topics.renameHint")}
          class="flex items-center gap-1.5 border-0 bg-transparent p-0"
          onClick={() => Topics.select(props.active ? null : props.topic.id)}
          onDblClick={(event) => {
            event.stopPropagation()
            setEditing(true)
          }}
        >
          <span class="size-1.5 shrink-0 rounded-full" style={{ "background-color": props.topic.color }} />
          <span class="max-w-[120px] truncate">{props.topic.name}</span>
        </button>
        <Show when={props.canCreateSession}>
          <button
            type="button"
            data-action="home-topic-new-session"
            class={action}
            title={language.t("home.topics.newSession")}
            aria-label={language.t("home.topics.newSession")}
            onClick={(event) => {
              event.stopPropagation()
              props.onCreateSession()
            }}
          >
            <Icon name="plus" size="small" />
          </button>
        </Show>
        <button
          type="button"
          data-action="home-topic-remove"
          class={action}
          title={language.t("home.topics.remove")}
          aria-label={language.t("home.topics.remove")}
          onClick={(event) => {
            event.stopPropagation()
            Topics.remove(props.topic.id)
          }}
        >
          <Icon name="xmark-small" size="small" />
        </button>
      </div>
    </Show>
  )
}
