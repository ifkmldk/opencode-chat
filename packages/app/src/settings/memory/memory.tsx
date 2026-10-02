import { type Component, createSignal, onMount } from "solid-js"
import { Schema } from "effect"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { DEFAULT_VAULT_DIR, normalizeVaultDir } from "./model"
import "@/settings/settings.css"

// fork: Settings → Memory. Vault path + auto-save persist locally (same
// persisted() pattern as the scraper tab). Entries list/export/import/sync
// lands with the sync worker.
const MemoryPrefs = Persistence.struct({ vaultDir: Schema.String, autoSave: Schema.Boolean })

export const SettingsMemory: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [stored, setStored] = persisted(Persist.global("fork-settings-memory"), MemoryPrefs, { vaultDir: "", autoSave: false })
  const vaultDir = () => normalizeVaultDir(stored.vaultDir)
  const autoSave = () => stored.autoSave === true
  const [count, setCount] = createSignal<number>()

  const refetch = () =>
    sdk.api.config
      .get()
      .then(() => setCount(undefined))
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
  onMount(() => void refetch())

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.memory")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.memory.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.memory.vault.title")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.memory.vault.dir.title")}
              description={language.t("settings.memory.vault.dir.description")}
            >
              <div data-action="settings-memory-vault-dir">
                <TextInput
                  value={vaultDir()}
                  placeholder={DEFAULT_VAULT_DIR}
                  spellcheck={false}
                  onInput={(event) => setStored("vaultDir", event.currentTarget.value)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.memory.autosave.title")}
              description={language.t("settings.memory.autosave.description")}
            >
              <div data-action="settings-memory-autosave">
                <Switch checked={autoSave()} onChange={(checked) => setStored("autoSave", checked)} hideLabel>
                  {language.t("settings.memory.autosave.title")}
                </Switch>
              </div>
            </SettingsRow>
          </SettingsList>
          {count() !== undefined ? (
            <p class="mt-2 text-11-regular text-v2-text-text-muted">
              {language.t("settings.memory.count", { count: String(count()) })}
            </p>
          ) : null}
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.memory.guide.title")}</h3>
          <p class="text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("settings.memory.guide.body")}
          </p>
        </div>
      </div>
    </>
  )
}
