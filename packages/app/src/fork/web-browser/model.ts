import { Schema } from "effect"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { usePlatform, type Platform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"

// fork: web Browser pane (v1 behaviour). The desktop app has a native browser view; in a browser tab,
// pages are framed through the server's /api/experimental/browser-proxy route instead.

export { isWebBrowserTab, webBrowserTab, WEB_BROWSER_TAB_PREFIX } from "./tab"
export { webBrowserAddress } from "./address"
import { webBrowserAddress } from "./address"

// Mirrors BROWSER_PROXY_TOKEN_HEADER in @opencode/protocol (the app depends on the client, not protocol):
// the custom header forces a CORS preflight so other origins cannot mint tickets.
const TICKET_HEADER = "x-opencode-ticket"

const Tab = Persistence.struct({ url: Schema.String, title: Schema.String })
const Saved = Persistence.struct({ tabs: Persistence.record(Tab) })

// History and loading state are per page load; only the address and title survive a reload.
const [live, setLive] = createStore<Record<string, { history: string[]; index: number; src?: string; loading: boolean; error?: string }>>({})

export function isLoopback(url: string) {
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === "http:" || protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
  } catch {
    return false
  }
}


// One saved store for every caller (tab strip and panes), owned by a root that outlives any component.
let shared: ReturnType<typeof createSaved> | undefined
function createSaved(platform: Platform) {
  return createRoot(() => persisted(Persist.global("fork-web-browser"), Saved, { tabs: {} }, platform))
}

export function useWebBrowser() {
  const sdk = useServerSDK()
  shared ??= createSaved(usePlatform())
  const [saved, setSaved] = shared

  const load = async (id: string, url: string) => {
    if (!live[id]) setLive(id, { history: [url], index: 0, loading: true })
    setLive(id, { loading: true, error: undefined })
    // Loopback pages (the preview plugin's canvas, local dev servers) are framed directly: the proxy refuses
    // loopback targets.
    if (isLoopback(url)) return setLive(id, { src: url })
    const result = await sdk.api.browserProxy
      .ticket({ url, [TICKET_HEADER]: "1" })
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
    if ("error" in result) return setLive(id, { loading: false, error: result.error })
    const src = new URL("/api/experimental/browser-proxy", sdk.url)
    src.searchParams.set("url", url)
    src.searchParams.set("ticket", result.ticket)
    setLive(id, { src: src.toString() })
  }

  const navigate = (id: string, input: string, mode: "push" | "replace" = "push") => {
    const url = webBrowserAddress(input)
    if (!url) return
    const current = live[id] ?? { history: [], index: -1, loading: false }
    const history = mode === "push" ? [...current.history.slice(0, current.index + 1), url] : current.history
    setLive(id, { history, index: mode === "push" ? history.length - 1 : current.index, loading: true })
    setSaved("tabs", id, { url, title: saved.tabs[id]?.title ?? "" })
    void load(id, url)
  }

  const step = (id: string, delta: number) => {
    const current = live[id]
    if (!current) return
    const index = current.index + delta
    const url = current.history[index]
    if (!url) return
    setLive(id, { index })
    setSaved("tabs", id, { url, title: "" })
    void load(id, url)
  }

  return {
    tab: (id: string) => ({
      url: saved.tabs[id]?.url ?? "",
      title: saved.tabs[id]?.title ?? "",
      src: live[id]?.src,
      loading: live[id]?.loading ?? false,
      error: live[id]?.error,
      canGoBack: (live[id]?.index ?? 0) > 0,
      canGoForward: !!live[id] && live[id]!.index < live[id]!.history.length - 1,
    }),
    create() {
      const id = crypto.randomUUID().slice(0, 8)
      setSaved("tabs", id, { url: "", title: "" })
      return id
    },
    /** Re-enter a tab when its pane mounts: restored from a previous page load, or remounted. */
    resume(id: string) {
      const url = saved.tabs[id]?.url
      if (!url) return
      if (!live[id]) return navigate(id, url)
      // Tickets are single-use, so a remounted frame cannot reuse its old address.
      setLive(id, "src", undefined)
      void load(id, url)
    },
    navigate,
    /** The tab already showing this URL's origin, so repeat canvas opens reuse one tab. */
    find: (url: string) => {
      const origin = URL.canParse(url) ? new URL(url).origin : undefined
      return Object.keys(saved.tabs).find((id) => {
        const current = saved.tabs[id]?.url
        return !!origin && !!current && URL.canParse(current) && new URL(current).origin === origin
      })
    },
    back: (id: string) => step(id, -1),
    forward: (id: string) => step(id, 1),
    reload: (id: string) => {
      const url = saved.tabs[id]?.url
      if (url) void load(id, url)
    },
    loaded: (id: string) => setLive(id, { loading: false }),
    page: (id: string, page: { title: string; url: string }) =>
      setSaved("tabs", id, { url: saved.tabs[id]?.url || page.url, title: page.title }),
    remove: (id: string) => setSaved("tabs", id, undefined!),
  }
}
