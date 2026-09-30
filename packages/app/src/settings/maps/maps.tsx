import { type Component, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

// fork: Settings → Maps. Google Maps data comes from the Gemini API free tier (a project without billing can
// never be charged); OpenStreetMap is the free fallback. The key goes into the credential store and is never
// shown again. See packages/core/src/maps/.
const INTEGRATION = "google-maps-gemini"
const LIMITS = [50, 100, 200, 300, 450]
const links = {
  keys: "https://aistudio.google.com/apikey",
  projects: "https://aistudio.google.com/projects",
  billing: "https://console.cloud.google.com/billing/projects",
  usage: "https://aistudio.google.com/rate-limit",
}

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
  const [form, setForm] = createStore({
    key: "",
    busy: false,
    test: undefined as { ok: boolean; message: string } | undefined,
  })

  const failed = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const update = (patch: {
    googleEnabled?: boolean
    confirmedFree?: boolean
    dailyLimit?: number
    osmEnabled?: boolean
  }) =>
    sdk.api.maps
      .settings(patch)
      .then((response) => mutate(() => response.data))
      .catch(failed)

  const save = async () => {
    const key = form.key.trim()
    if (!key) return
    setForm("busy", true)
    await sdk.api.integration.connect
      .key({ integrationID: INTEGRATION, key })
      .then(() => {
        setForm({ key: "", test: undefined })
        showToast({ variant: "success", icon: "circle-check", title: language.t("settings.maps.key.saved") })
        return refetch()
      })
      .catch(failed)
    setForm("busy", false)
  }

  const remove = async () => {
    setForm("busy", true)
    await sdk.api.integration
      .get({ integrationID: INTEGRATION })
      .then((integration) =>
        Promise.all(
          (integration.data?.connections ?? [])
            .filter((connection) => connection.type === "credential")
            .map((connection) => sdk.api.credential.remove({ credentialID: connection.id })),
        ),
      )
      .then(() => refetch())
      .catch(failed)
    setForm({ busy: false, test: undefined })
  }

  const test = async () => {
    setForm("busy", true)
    await sdk.api.maps
      .test()
      .then((response) => {
        mutate(() => response.data.status)
        setForm("test", { ok: response.data.ok, message: response.data.message })
      })
      .catch(failed)
    setForm("busy", false)
  }

  const resetTime = () => {
    const value = status()?.google.resetsAt
    return value
      ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
      : ""
  }

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
          <h3 class="settings-section-title">{language.t("settings.maps.google.title")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.maps.key.title")}
              description={
                status()?.google.source === "env"
                  ? language.t("settings.maps.key.env")
                  : status()?.google.configured
                    ? language.t("settings.maps.key.stored")
                    : language.t("settings.maps.key.description")
              }
            >
              <Show
                when={!status()?.google.configured}
                fallback={
                  <Show when={status()?.google.source === "credential"}>
                    <Button
                      variant="ghost-muted"
                      disabled={form.busy}
                      onClick={() => void remove()}
                      data-action="settings-maps-remove"
                    >
                      {language.t("settings.maps.key.remove")}
                    </Button>
                  </Show>
                }
              >
                <form
                  class="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save()
                  }}
                >
                  <TextField
                    type="password"
                    autocomplete="off"
                    hideLabel
                    label={language.t("settings.maps.key.title")}
                    placeholder={language.t("settings.maps.key.placeholder")}
                    value={form.key}
                    onChange={(value) => setForm("key", value)}
                    data-action="settings-maps-key"
                  />
                  <Button type="submit" variant="contrast" disabled={form.busy || !form.key.trim()}>
                    {language.t("settings.maps.key.save")}
                  </Button>
                </form>
              </Show>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.maps.free.title")}
              description={
                <>
                  {language.t("settings.maps.free.description")}{" "}
                  <ExternalLink href={links.projects}>{language.t("settings.maps.free.link")}</ExternalLink>
                </>
              }
            >
              <div data-action="settings-maps-confirm-free">
                <Switch
                  checked={status()?.google.confirmedFree ?? false}
                  onChange={(checked) => void update({ confirmedFree: checked })}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.maps.enabled.title")}
              description={language.t("settings.maps.enabled.description")}
            >
              <div data-action="settings-maps-google-enabled">
                <Switch
                  checked={status()?.google.enabled ?? true}
                  onChange={(checked) => void update({ googleEnabled: checked })}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.maps.test.title")}
              description={
                form.test
                  ? `${language.t(form.test.ok ? "settings.maps.test.ok" : "settings.maps.test.failed")} ${form.test.message}`
                  : language.t("settings.maps.test.description")
              }
            >
              <Button
                variant="neutral"
                disabled={form.busy || !status()?.google.configured || !status()?.google.confirmedFree}
                onClick={() => void test()}
                data-action="settings-maps-test"
              >
                {language.t("settings.maps.test.action")}
              </Button>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.maps.usage.title")}
              description={
                status()?.google.exhaustedToday
                  ? language.t("settings.maps.usage.exhausted", { time: resetTime() })
                  : language.t("settings.maps.usage.description", {
                      used: String(status()?.google.usedToday ?? 0),
                      limit: String(status()?.google.dailyLimit ?? 0),
                      free: String(status()?.google.freeDaily ?? 500),
                      time: resetTime(),
                    })
              }
            >
              <Select
                data-action="settings-maps-limit"
                options={LIMITS}
                current={status()?.google.dailyLimit ?? 450}
                value={(option) => String(option)}
                label={(option) => language.t("settings.maps.usage.limit", { limit: String(option) })}
                onSelect={(option) => option !== undefined && option !== null && void update({ dailyLimit: option })}
                placement="bottom-end"
                gutter={6}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.maps.osm.title")}</h3>
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
          <ol
            class="flex list-decimal flex-col gap-2 pl-5 text-13-regular text-v2-text-text-muted"
            data-component="settings-maps-guide"
          >
            <li>
              {language.t("settings.maps.guide.step1")}{" "}
              <ExternalLink href={links.keys}>{language.t("settings.maps.guide.keys")}</ExternalLink>
            </li>
            <li>
              {language.t("settings.maps.guide.step2")}{" "}
              <ExternalLink href={links.projects}>{language.t("settings.maps.free.link")}</ExternalLink>
            </li>
            <li>
              {language.t("settings.maps.guide.step3")}{" "}
              <ExternalLink href={links.billing}>{language.t("settings.maps.guide.billing")}</ExternalLink>
            </li>
            <li>{language.t("settings.maps.guide.step4")}</li>
            <li>
              {language.t("settings.maps.guide.step5")}{" "}
              <ExternalLink href={links.usage}>{language.t("settings.maps.guide.usage")}</ExternalLink>
            </li>
          </ol>
          <p class="mt-3 text-11-regular text-v2-text-text-muted">{language.t("settings.maps.guide.privacy")}</p>
        </div>
      </div>
    </>
  )
}
