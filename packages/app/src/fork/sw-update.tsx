import { createEffect, createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

// fork: upstream keeps an open window on its build until every client closes (skipWaiting: false), and a window
// that stays open never re-checks /sw.js, so after a deploy the owner kept the old UI for days. This checks for a
// new build on focus and every 10 minutes, and offers a reload that switches every open window over.

const [waiting, setWaiting] = createSignal<ServiceWorker>()
const CHECK_MS = 10 * 60_000

export function watchServiceWorker(registration: ServiceWorkerRegistration) {
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return
    const ready = () => {
      // With no controller this is the first install, not an update.
      if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker)
    }
    ready()
    worker.addEventListener("statechange", ready)
  }
  track(registration.waiting)
  registration.addEventListener("updatefound", () => track(registration.installing))
  const check = () => void registration.update().catch(() => undefined)
  window.addEventListener("focus", check)
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check())
  setInterval(check, CHECK_MS)
  // Any window that takes the update (here or in another window) reloads onto it.
  let reloading = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

export function ServiceWorkerUpdate() {
  const language = useLanguage()
  createEffect(() => {
    const worker = waiting()
    if (!worker) return
    showToast({
      title: language.t("app.update.ready.title"),
      description: language.t("app.update.ready.description"),
      persistent: true,
      actions: [
        // Workbox's generated worker skips waiting on this message; controllerchange then reloads.
        { label: language.t("app.update.ready.reload"), onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
        { label: language.t("app.update.ready.later"), onClick: "dismiss" },
      ],
    })
  })
  return null
}
