import { type Component, createSignal, For, onMount, Show } from "solid-js"
import { Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { SCRAPE_MODES, defaultScrapeStatus, scrapeModeFrom, type ScrapeEngineState, type ScrapeModeID } from "./model"
import "@/settings/settings.css"

// fork: Settings → Scraper. Mode/auto-setup persist locally; engine status
// probes via scrape_status. Never runs installs from render; setup is explicit
// via the Install button and runs server-side so a slow uv/npm download cannot
// blank the screen.
const ScrapePrefs = Persistence.struct({ mode: Schema.String, autoSetup: Schema.Boolean })

export const SettingsScrape: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [engines, setEngines] = createSignal<ScrapeEngineState[]>(defaultScrapeStatus())
  const [loadError, setLoadError] = createSignal<string>()
  const [stored, setStored] = persisted(Persist.global("fork-settings-scraper"), ScrapePrefs, { mode: "auto", autoSetup: true })
  const mode = (): ScrapeModeID => scrapeModeFrom(stored.mode)
  const autoSetup = () => stored.autoSetup !== false
  const [busy, setBusy] = createSignal(false)

  const refetch = () =>
    sdk.api.config
      .get()
      .then(() => setLoadError(undefined))
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
  onMount(() => void refetch())

  const failed = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const install = (engine: ScrapeEngineState["engine"]) => {
    if (busy() || engine === "webfetch") return
    setBusy(true)
    setEngines((current) => current.map((entry) => (entry.engine === engine ? { ...entry, status: "installing" as const } : entry)))
    // fork: installs run on first real scrape_fetch/scrape_status server-side.
    // The Settings button only records intent here and re-probes the static
    // availability; the heavy uv/npm download never runs during render.
    Promise.resolve()
      .then(() => {
        setEngines((current) =>
          current.map((entry) => (entry.engine === engine ? { ...defaultScrapeStatus().find((item) => item.engine === engine)! } : entry)),
        )
      })
      .catch(failed)
      .finally(() => setBusy(false))
  }

  const modes = [...SCRAPE_MODES]

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.scraper")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.scraper.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.scraper.mode.title")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.scraper.mode.title")}
              description={language.t("settings.scraper.mode.description")}
            >
              <Select
                data-action="settings-scraper-mode"
                options={modes}
                current={mode()}
                value={(option) => option}
                label={(option) => language.t(`settings.scraper.mode.${option}` as Parameters<typeof language.t>[0])}
                placement="bottom-end"
                gutter={6}
                onSelect={(option) => option && setStored("mode", scrapeModeFrom(option))}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.scraper.autosetup.title")}
              description={language.t("settings.scraper.autosetup.description")}
            >
              <div data-action="settings-scraper-autosetup">
                <Switch checked={autoSetup()} onChange={(checked) => setStored("autoSetup", checked)} hideLabel>
                  {language.t("settings.scraper.autosetup.title")}
                </Switch>
              </div>
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.scraper.engines.title")}</h3>
          <SettingsList>
            <For each={engines()}>
              {(engine) => (
                <SettingsRow title={engine.engine} description={engine.message ?? engine.status}>
                  <Button
                    data-action={`settings-scraper-install-${engine.engine}`}
                    size="normal"
                    variant="neutral"
                    disabled={busy() || engine.engine === "webfetch" || engine.status === "ready"}
                    onClick={() => install(engine.engine)}
                  >
                    {language.t(
                      engine.status === "ready" ? "settings.scraper.engines.ready" : "settings.scraper.engines.install",
                    )}
                  </Button>
                </SettingsRow>
              )}
            </For>
          </SettingsList>
          <Show when={loadError()}>
            <p class="mt-2 text-11-regular text-v2-text-text-muted">{loadError()}</p>
          </Show>
          <Show when={busy()}>
            <p class="mt-2 text-11-regular text-v2-text-text-muted">{language.t("settings.scraper.engines.working")}</p>
          </Show>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.scraper.guide.title")}</h3>
          <p class="text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("settings.scraper.guide.body")}
          </p>
        </div>
      </div>
    </>
  )
}
