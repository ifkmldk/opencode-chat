import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsRow } from "@/settings/row"
import { RESEARCH_PROVIDER_FIELDS, researchExportBlock, validateResearchProviderUrl } from "./research-provider-fields"

/**
 * Research provider endpoints + action executor.
 * Read-only helper: the app never writes process.env itself. Editing here
 * only validates + copies export commands the user applies on restart.
 * Secrets are never rendered back: only presence, never values.
 */
export const ResearchProvidersSetting: Component = () => {
  const language = useLanguage()
  const [drafts, setDrafts] = createSignal<Record<string, string>>({})
  const [copied, setCopied] = createSignal(false)
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

  return (
    <SettingsRow
      title={language.t("settings.general.row.researchProviders.title")}
      description={language.t("settings.general.row.researchProviders.description")}
    >
      <div class="flex w-full flex-col gap-3" data-action="settings-research-providers">
        <For each={RESEARCH_PROVIDER_FIELDS}>
          {(field) => {
            const error = () => {
              const key = validateResearchProviderUrl(drafts()[field.env] ?? "")
              return key ? language.t(key as Parameters<typeof language.t>[0]) : undefined
            }
            return (
              <label class="flex flex-col gap-1 text-11-medium text-text-weak">
                <span class="flex items-center justify-between gap-2">
                  <span>{field.label}</span>
                  <code class="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-10-regular text-text-faint">{field.env}</code>
                </span>
                <TextInput
                  value={drafts()[field.env] ?? ""}
                  placeholder="https://…"
                  inputMode="url"
                  spellcheck={false}
                  onInput={(event) => setDraft(field.env, event.currentTarget.value)}
                />
                <Show when={error()}>
                  <span class="text-11-regular text-text-danger">{error()}</span>
                </Show>
                <span class="text-10-regular text-text-faint">{field.hint}</span>
              </label>
            )
          }}
        </For>
        <label class="flex flex-col gap-1 text-11-medium text-text-weak">
          <span class="flex items-center justify-between gap-2">
            <span>{language.t("settings.general.row.researchProviders.webhook")}</span>
            <code class="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-10-regular text-text-faint">OPENCODE_ACTION_WEBHOOK</code>
          </span>
          <TextInput
            value={drafts().OPENCODE_ACTION_WEBHOOK ?? ""}
            placeholder="https://…"
            inputMode="url"
            spellcheck={false}
            onInput={(event) => setDraft("OPENCODE_ACTION_WEBHOOK", event.currentTarget.value)}
          />
          <span class="text-10-regular text-text-faint">{language.t("settings.general.row.researchProviders.webhookHint")}</span>
        </label>
        <label class="flex flex-col gap-1 text-11-medium text-text-weak">
          <span>{language.t("settings.general.row.researchProviders.exportLabel")}</span>
          <textarea
            readonly
            rows={6}
            class="rounded-md border border-border-weaker-base bg-background-base p-2 font-mono text-10-regular text-text-weak"
            value={researchExportBlock(drafts())}
          />
        </label>
        <div class="flex items-center gap-2">
          <Button size="normal" variant="neutral" data-action="settings-research-providers-copy" onClick={copyExports}>
            {language.t(copied() ? "settings.general.row.researchProviders.copied" : "settings.general.row.researchProviders.copy")}
          </Button>
        </div>
        <span class="text-10-regular text-text-faint">{language.t("settings.general.row.researchProviders.restartNote")}</span>
      </div>
    </SettingsRow>
  )
}
