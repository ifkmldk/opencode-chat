import { Show, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import {
  RESEARCH_CATEGORY_HINTS,
  RESEARCH_PROMPT_TEMPLATES,
  addResearchHistory,
  clearResearchHistory,
  loadResearchHistory,
  researchSearchPrompt,
  saveResearchHistory,
  validateResearchFilters,
} from "@opencode/session-ui/research-events"
import { useArtifactOpener } from "@/session/files/open-artifact"
import { useComposerState } from "@/composer/persistence"
import { appendDraftText, promptLength } from "@/composer/prompt-parts"
import { useLanguage } from "@/runtime/i18n/language"

const categories = ["job", "hotel", "flight", "product", "youtube", "place", "event", "course", "service"] as const
type Category = (typeof categories)[number]

const field =
  "h-9 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3 text-12-regular text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
const listItem =
  "truncate rounded-md px-2 py-1 text-left text-12-regular text-v2-text-text-muted transition hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"

export function SessionResearchPanel() {
  const composer = useComposerState()
  const language = useLanguage()
  let artifacts: ReturnType<typeof useArtifactOpener> | undefined
  try {
    artifacts = useArtifactOpener()
  } catch {
    artifacts = undefined
  }
  const gallery = () => artifacts?.gallery() ?? []
  const [query, setQuery] = createSignal("")
  const [category, setCategory] = createSignal<Category>("job")
  const [location, setLocation] = createSignal("")
  const [budget, setBudget] = createSignal("")

  // Prefill appends to the draft; never wipe what the user already wrote.
  const insert = (text: string) => {
    const next = appendDraftText(composer.current(), text)
    composer.set(next, promptLength(next))
  }

  const ask = () => {
    const value = query().trim()
    if (!value) return
    const filters = { query: value, category: category(), location: location(), budget: budget() }
    saveResearchHistory(addResearchHistory(loadResearchHistory(), filters))
    insert(researchSearchPrompt(filters))
  }

  const hint = createMemo(() => RESEARCH_CATEGORY_HINTS[category()] ?? "")
  const warning = createMemo(() =>
    validateResearchFilters({ query: query(), category: category(), location: location(), budget: budget() }),
  )
  const [history, setHistory] = createSignal(loadResearchHistory())
  const templates = RESEARCH_PROMPT_TEMPLATES

  const applyHistory = (entry: { query: string; category: string; location: string; budget: string }) => {
    setQuery(entry.query)
    setCategory(entry.category as Category)
    setLocation(entry.location)
    setBudget(entry.budget)
  }

  const refreshHistory = () => setHistory(loadResearchHistory())
  const clearHistory = () => {
    clearResearchHistory()
    setHistory([])
  }

  onMount(() => refreshHistory())

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4" data-slot="session-research-panel">
      <div class="flex items-start gap-3">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-v2-background-bg-layer-01 text-v2-text-text-accent">
          <Icon name="sparkles" class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="text-13-medium text-v2-text-text-base">{language.t("session.research.title")}</div>
          <div class="mt-1 text-12-regular text-v2-text-text-muted">{language.t("session.research.description")}</div>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-12-medium text-v2-text-text-muted" for="research-query">
          {language.t("session.research.query.label")}
        </label>
        <input
          id="research-query"
          data-action="research-query"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={language.t("session.research.query.placeholder")}
          class={field}
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-12-medium text-v2-text-text-muted">
          {language.t("session.research.category")}
          <select
            data-action="research-category"
            value={category()}
            onChange={(event) => setCategory(event.currentTarget.value as Category)}
            class={field}
          >
            {categories.map((value) => (
              <option value={value}>{language.t(`session.research.category.${value}`)}</option>
            ))}
          </select>
        </label>
        <label class="flex flex-col gap-1 text-12-medium text-v2-text-text-muted">
          {language.t("session.research.location")}
          <input
            data-action="research-location"
            value={location()}
            onInput={(event) => setLocation(event.currentTarget.value)}
            placeholder={language.t("session.research.optional")}
            class={field}
          />
        </label>
      </div>
      <label class="flex flex-col gap-1 text-12-medium text-v2-text-text-muted">
        {language.t("session.research.budget")}
        <input
          data-action="research-budget"
          value={budget()}
          onInput={(event) => setBudget(event.currentTarget.value)}
          placeholder={language.t("session.research.budget.placeholder")}
          class={field}
        />
      </label>
      <Show when={hint()}>
        <div data-action="research-hint" class="text-12-regular text-v2-text-text-muted">
          {hint()}
        </div>
      </Show>
      <Show when={warning()}>
        <div data-action="research-warning" class="text-12-regular text-icon-warning-base">
          {warning()}
        </div>
      </Show>
      <Button
        data-action="research-ask-chat"
        onClick={() => {
          ask()
          refreshHistory()
        }}
        disabled={!query().trim()}
        class="w-full justify-center"
      >
        <Icon name="sparkles" class="size-4" />
        {language.t("session.research.ask")}
      </Button>
      <div class="flex flex-col gap-2">
        <div class="text-12-medium text-v2-text-text-muted">{language.t("session.research.templates")}</div>
        <div class="flex flex-wrap gap-1">
          {templates.map((template) => (
            <Button
              size="small"
              variant="ghost"
              data-action="research-template"
              data-template={template.id}
              title={template.body}
              onClick={() => insert(template.body)}
            >
              {template.title}
            </Button>
          ))}
        </div>
      </div>
      <Show when={history().length > 0}>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-12-medium text-v2-text-text-muted">{language.t("session.research.history")}</div>
            <Button size="small" variant="ghost" data-action="research-history-clear" onClick={clearHistory}>
              {language.t("session.research.history.clear")}
            </Button>
          </div>
          <div class="flex flex-col gap-1">
            {history()
              .slice(0, 5)
              .map((entry) => (
                <button
                  type="button"
                  data-action="research-history"
                  class={listItem}
                  title={`${entry.query} · ${entry.category}`}
                  onClick={() => applyHistory(entry)}
                >
                  {entry.query}
                </button>
              ))}
          </div>
        </div>
      </Show>
      <Show when={gallery().length > 0}>
        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-v2-text-text-muted">{language.t("session.research.gallery")}</div>
          <div class="flex flex-col gap-1">
            {gallery()
              .slice(0, 8)
              .map((entry) => (
                <button
                  type="button"
                  data-action="research-gallery"
                  data-kind={entry.kind}
                  class={listItem}
                  title={`${entry.path} · ${entry.kind}`}
                  onClick={() => artifacts?.open(entry.path)}
                >
                  {entry.path}
                </button>
              ))}
          </div>
        </div>
      </Show>
      <div class="rounded-lg bg-v2-background-bg-layer-01 p-3 text-12-regular text-v2-text-text-muted">
        <div class="mb-1 text-12-medium text-v2-text-text-base">{language.t("session.research.how.title")}</div>
        {language.t("session.research.how.body")}
      </div>
    </div>
  )
}
