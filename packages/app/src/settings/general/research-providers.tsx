import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettingsSurface } from "@/settings/surface"
import { RESEARCH_PROVIDER_FIELDS, researchExportBlock, validateResearchProviderUrl } from "./research-provider-fields"

/**
 * Research provider endpoints + action executor.
 * Read-only helper: the app never writes process.env itself. Editing here
 * only validates + copies export commands the user applies on restart.
 * Secrets are never rendered back: only presence, never values.
 */
// fork: a full-width block below the General list; as a row control it was squeezed into the right column.
export const ResearchProvidersSetting: Component = () => {
  const language = useLanguage()
  const surface = useSettingsSurface()
  const [drafts, setDrafts] = createSignal<Record<string, string>>({})
  const [copied, setCopied] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const setDraft = (env: string, value: string) => setDrafts((current) => ({ ...current, [env]: value }))

  const copyExports = async () => {
    try {
      await navigator.clipboard.writeText(researchExportBlock(drafts()))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable: the textarea below stays selectable.
    }
  }

  const label = "flex flex-col gap-1 text-12-medium text-v2-text-text-muted"
  const env = "rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-10-regular text-v2-text-text-faint"
  const hint = "text-11-regular text-v2-text-text-faint"

  // fork: collapsed by default. Tanpa API key pun research jalan (OSM + scraper-first
  // via research_deep: OSM geocode, filter radius/koridor, scrape-verify atribut).
  // Endpoint custom di bawah opsional untuk listing live; yang scraper butuhkan
  // (Mamikos/Rukita/Jobstreet/dll) tidak perlu API key.
  return (
    <div class="mt-6" data-action="settings-research-providers">
      <h4 class="text-13-medium leading-[var(--line-height-compact)] text-v2-text-text-base">
        {language.t("settings.general.row.researchProviders.title")}
      </h4>
      <p class="mt-1 text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
        {language.t("settings.general.row.researchProviders.notNeeded")}{" "}
        <button
          type="button"
          class="underline text-v2-text-text-base"
          data-action="settings-research-providers-open-maps"
          onClick={() => surface.select("maps")}
        >
          {language.t("settings.general.row.researchProviders.openMaps")}
        </button>
      </p>
      <Button
        class="mt-3"
        size="normal"
        variant="ghost-muted"
        data-action="settings-research-providers-toggle"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        {language.t(
          open() ? "settings.general.row.researchProviders.hide" : "settings.general.row.researchProviders.show",
        )}
      </Button>
      <Show when={open()}>
        <div class="mt-4 flex flex-col gap-4">
          <p class="text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("settings.general.row.researchProviders.description")}
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <For each={RESEARCH_PROVIDER_FIELDS}>
              {(field) => {
                const error = () => {
                  const key = validateResearchProviderUrl(drafts()[field.env] ?? "")
                  return key ? language.t(key as Parameters<typeof language.t>[0]) : undefined
                }
                return (
                  <label class={label}>
                    <span class="flex items-center justify-between gap-2">
                      <span>{field.label}</span>
                      <code class={env}>{field.env}</code>
                    </span>
                    <TextInput
                      value={drafts()[field.env] ?? ""}
                      placeholder="https://…"
                      inputMode="url"
                      spellcheck={false}
                      onInput={(event) => setDraft(field.env, event.currentTarget.value)}
                    />
                    <Show when={error()}>
                      <span class="text-11-regular text-icon-critical-base">{error()}</span>
                    </Show>
                    <span class={hint}>{field.hint}</span>
                  </label>
                )
              }}
            </For>
            <label class={label}>
              <span class="flex items-center justify-between gap-2">
                <span>{language.t("settings.general.row.researchProviders.webhook")}</span>
                <code class={env}>OPENCODE_ACTION_WEBHOOK</code>
              </span>
              <TextInput
                value={drafts().OPENCODE_ACTION_WEBHOOK ?? ""}
                placeholder="https://…"
                inputMode="url"
                spellcheck={false}
                onInput={(event) => setDraft("OPENCODE_ACTION_WEBHOOK", event.currentTarget.value)}
              />
              <span class={hint}>{language.t("settings.general.row.researchProviders.webhookHint")}</span>
            </label>
          </div>
          <label class={label}>
            <span>{language.t("settings.general.row.researchProviders.exportLabel")}</span>
            <textarea
              readonly
              rows={6}
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-2 font-mono text-11-regular text-v2-text-text-muted"
              value={researchExportBlock(drafts())}
            />
          </label>
          <div class="flex items-center gap-3">
            <Button
              size="normal"
              variant="neutral"
              data-action="settings-research-providers-copy"
              onClick={copyExports}
            >
              {language.t(
                copied()
                  ? "settings.general.row.researchProviders.copied"
                  : "settings.general.row.researchProviders.copy",
              )}
            </Button>
            <span class={hint}>{language.t("settings.general.row.researchProviders.restartNote")}</span>
          </div>
        </div>
      </Show>
    </div>
  )
}
