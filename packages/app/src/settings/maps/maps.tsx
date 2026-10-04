import { type Component, createSignal, onMount, Show } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

// fork: Settings → Maps. OSM-only (Google/Gemini removed per user decision — no key,
// never billed). All place data comes from OpenStreetMap + Wikimedia + scraped attribution.
// Keyless Google Maps URLs (links.ts) open the real app/website, no API key. See core/src/maps/.

export const SettingsMaps: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  // Plain signals, not createResource: a resource read during render suspends the nearest <Suspense>, which is the
  // whole app shell, so a slow first status request (a project still loading its plugins) blanked the screen.
  type Status = Awaited<ReturnType<typeof sdk.api.maps.status>>["data"]
  const [status, mutate] = createSignal<Status>()
  const [loadError, setLoadError] = createSignal<string>()
  const refetch = () =>
    sdk.api.maps
      .status()
      .then((response) => {
        setLoadError(undefined)
        mutate(() => response.data)
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
  onMount(() => void refetch())

  const failed = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const update = (patch: { osmEnabled?: boolean }) =>
    sdk.api.maps
      .settings(patch)
      .then((response) => mutate(() => response.data))
      .catch(failed)

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.maps")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.maps.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned" data-component="settings-maps">
        <Show when={!status() || loadError()}>
          <p class="text-12-regular text-v2-text-text-muted" data-slot="settings-maps-loading">
            {loadError()
              ? language.t("settings.maps.loadFailed", { error: loadError()! })
              : language.t("settings.maps.loading")}
          </p>
        </Show>
        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.maps.osm.title")}</h3>
          <p class="text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("settings.maps.osmOnlyNotice")}
          </p>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.maps.osm.enabled.title")}
              description={language.t("settings.maps.osm.enabled.description")}
            >
              <div data-action="settings-maps-osm-enabled">
                <Switch
                  checked={status()?.osm.enabled ?? true}
                  onChange={(checked) => void update({ osmEnabled: checked })}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.maps.guide.title")}</h3>
          <p class="text-12-regular leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("settings.maps.guide.osmOnly")}
          </p>
          <p class="mt-3 text-11-regular text-v2-text-text-muted">{language.t("settings.maps.guide.privacy")}</p>
        </div>
      </div>
    </>
  )
}
