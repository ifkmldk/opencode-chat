export * as ScrapeChromium from "./chromium.js"

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OfficeEngine } from "../office/engine.js"

// fork: a rendering tier that needs nothing installed. The Chromium-family browser already on the PC (Playwright
// Chromium, Chrome or Brave) is started headless and driven over the DevTools protocol: load the page, let its scripts
// settle, scroll once to trigger lazy lists, then read the final DOM. That covers JavaScript-rendered careers pages and
// SPAs that a plain GET returns as an empty shell, without Python, uvx or a 300 MB Firefox download. A hard timeout
// still returns whatever the DOM holds, because a partial page beats an error for a slow site.
//
// The same connection also drives pages like a person does (type into the search box, click, scroll, screenshot) and
// records the JSON the page's own scripts fetch, for sites whose results only appear after using the page's UI.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

export const available = () => (process.env.OPENCODE_SCRAPER_NO_CHROMIUM === "1" ? undefined : OfficeEngine.chromium())

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const killTree = (pid: number | undefined) => {
  if (!pid) return
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
  else
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
}

const removeProfile = (profile: string) => {
  // The browser may still hold files for a moment after it is killed.
  setTimeout(() => {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {}
  }, 1500)
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void }

export type Rendered = { html: string; finalUrl: string; title: string }
export type Captured = { url: string; status: number; body: string }

export type Page = {
  navigate: (url: string, timeoutMs: number) => Promise<void>
  settle: (waitMs: number) => Promise<void>
  evaluate: <T = unknown>(expression: string) => Promise<T>
  click: (target: string) => Promise<boolean>
  fill: (target: string, text: string) => Promise<boolean>
  press: (key: "Enter" | "Escape" | "Tab") => Promise<void>
  scroll: (times?: number) => Promise<void>
  screenshot: (options?: { full?: boolean; jpeg?: number }) => Promise<Buffer>
  /** Draws a red frame around an element (for step-by-step guides); `clear` removes all frames. */
  highlight: (target: string | "clear") => Promise<boolean>
  read: () => Promise<Rendered>
  /** JSON responses the page fetched since the page was opened (only bodies that look like JSON, capped). */
  json: () => Captured[]
}

export type Browser = { page: () => Promise<Page>; close: () => void }

/** Starts a headless browser. A `profile` folder keeps cookies between calls (a login the user did there stays). */
export async function launch(options: { timeoutMs: number; proxy?: string; profile?: string }): Promise<Browser> {
  const browser = available()
  if (!browser) throw new Error("No Chromium-based browser (Playwright Chromium, Chrome or Brave) was found on this computer.")
  const profile = options.profile ?? fs.mkdtempSync(path.join(os.tmpdir(), "opencode-scrape-"))
  if (options.profile) fs.mkdirSync(options.profile, { recursive: true })
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--window-size=1366,900",
      `--user-data-dir=${profile}`,
      `--user-agent=${USER_AGENT}`,
      ...(options.proxy ? [`--proxy-server=${options.proxy}`] : []),
      "about:blank",
    ],
    { windowsHide: true },
  )
  const close = () => {
    killTree(child.pid)
    if (!options.profile) removeProfile(profile)
  }
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let text = ""
      const timer = setTimeout(() => reject(new Error("Chromium did not start")), Math.min(15_000, options.timeoutMs))
      child.stderr.on("data", (chunk) => {
        text += String(chunk)
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(text)
        if (match) {
          clearTimeout(timer)
          resolve(match[1]!)
        }
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on("close", () => {
        clearTimeout(timer)
        reject(new Error("Chromium exited before it was ready (is another copy using the same profile?)"))
      })
    })
    const socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("Could not connect to Chromium"))
    })
    let counter = 0
    const pending = new Map<number, Pending>()
    const listeners: Array<(message: { method?: string; params?: any; sessionId?: string }) => void> = []
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string }
      if (message.id !== undefined) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) entry?.reject(new Error(message.error.message))
        else entry?.resolve(message.result)
        return
      }
      listeners.forEach((listener) => listener(message))
    }
    const send = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
      new Promise<T>((resolve, reject) => {
        const id = ++counter
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    return {
      close: () => {
        socket.close()
        close()
      },
      page: () => openPage(send, listeners),
    }
  } catch (error) {
    close()
    throw error
  }
}

async function openPage(
  send: <T>(method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<T>,
  listeners: Array<(message: { method?: string; params?: any; sessionId?: string }) => void>,
): Promise<Page> {
  const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
  await send("Page.enable", {}, sessionId)
  await send("Network.enable", {}, sessionId)
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId).catch(() => undefined)
  const captured: Captured[] = []
  const responses = new Map<string, { url: string; status: number }>()
  const loadWaiters: Array<() => void> = []
  listeners.push((message) => {
    if (message.sessionId !== sessionId) return
    if (message.method === "Page.loadEventFired") loadWaiters.splice(0).forEach((resolve) => resolve())
    if (message.method === "Network.responseReceived") {
      const response = message.params.response as { url: string; status: number; mimeType: string }
      if (/json|graphql/i.test(response.mimeType) || /graphql|\/api\//i.test(response.url)) responses.set(message.params.requestId, { url: response.url, status: response.status })
    }
    if (message.method === "Network.loadingFinished") {
      const meta = responses.get(message.params.requestId)
      if (!meta || captured.length >= 80) return
      responses.delete(message.params.requestId)
      send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", { requestId: message.params.requestId }, sessionId)
        .then((result) => {
          const body = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body
          if (/^\s*[[{]/.test(body)) captured.push({ ...meta, body: body.slice(0, 2_000_000) })
        })
        .catch(() => undefined)
    }
  })
  const evaluate = async <T>(expression: string) => {
    const result = await send<{ result: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)
    return result.result.value as T
  }
  const settle = async (waitMs: number) => {
    // Wait until the page text stops growing (client-side lists arrive after the load event), at most `waitMs`.
    const until = Date.now() + waitMs
    let last = -1
    let steady = 0
    while (Date.now() < until && steady < 2) {
      await delay(700)
      const size = await evaluate<number>("document.body ? document.body.innerText.length : 0").catch(() => -1)
      steady = size === last ? steady + 1 : 0
      last = size
    }
  }
  // Finds an element by CSS selector, else by visible text / label / placeholder / aria-label, and returns its centre.
  const locate = (target: string, kind: "click" | "input") =>
    evaluate<{ x: number; y: number } | null>(`(() => {
      const t = ${JSON.stringify(target)}; const low = t.toLowerCase().trim();
      let el = null; try { el = document.querySelector(t) } catch (e) {}
      const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
      if (!el) {
        const pool = ${kind === "input" ? `[...document.querySelectorAll("input,textarea,[contenteditable=true],[role=combobox],[role=searchbox]")]` : `[...document.querySelectorAll("a,button,[role=button],[role=option],[role=tab],li,label,input[type=submit],span,div")]`};
        const text = (e) => [e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), e.getAttribute("name"), e.labels && e.labels[0] && e.labels[0].innerText, ${kind === "click" ? "e.innerText" : "''"}].filter(Boolean).join(" ").toLowerCase().trim();
        el = pool.filter(visible).find((e) => text(e) === low) || pool.filter(visible).filter((e) => text(e).includes(low)).sort((a, b) => text(a).length - text(b).length)[0] || null;
      }
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      if (${kind === "input"}) el.focus();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`)
  const mouse = async (x: number, y: number) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId)
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId)
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId)
  }
  const keys = { Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }, Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 } }
  return {
    navigate: async (url, timeoutMs) => {
      const loaded = new Promise<void>((resolve) => {
        loadWaiters.push(resolve)
        setTimeout(resolve, timeoutMs)
      })
      await send("Page.navigate", { url }, sessionId)
      await loaded
    },
    settle,
    evaluate,
    click: async (target) => {
      const point = await locate(target, "click")
      if (!point) return false
      await mouse(point.x, point.y)
      await delay(400)
      return true
    },
    fill: async (target, text) => {
      const point = await locate(target, "input")
      if (!point) return false
      await mouse(point.x, point.y)
      await evaluate(`(() => { const e = document.activeElement; if (e && "value" in e) { e.select && e.select(); } })()`)
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 }, sessionId)
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 }, sessionId)
      await send("Input.insertText", { text }, sessionId)
      await delay(500)
      return true
    },
    press: async (key) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...keys[key] }, sessionId)
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...keys[key], text: undefined }, sessionId)
      await delay(400)
    },
    scroll: async (times = 1) => {
      for (let i = 0; i < times; i++) {
        await evaluate("window.scrollBy(0, Math.max(600, window.innerHeight * 0.9))").catch(() => undefined)
        await delay(900)
      }
    },
    highlight: async (target) => {
      if (target === "clear") {
        await evaluate("document.querySelectorAll('[data-opencode-highlight]').forEach((e) => e.remove())")
        return true
      }
      const point = await locate(target, "click")
      if (!point) return false
      return await evaluate<boolean>(`(() => {
        const x = ${point.x}, y = ${point.y}; let el = document.elementFromPoint(x, y); if (!el) return false;
        const r = el.getBoundingClientRect(); const box = document.createElement("div"); box.setAttribute("data-opencode-highlight", "");
        box.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;border:3px solid #e5484d;border-radius:6px;box-shadow:0 0 0 4px rgba(229,72,77,.25)";
        box.style.left = (r.left + window.scrollX - 4) + "px"; box.style.top = (r.top + window.scrollY - 4) + "px"; box.style.width = (r.width + 8) + "px"; box.style.height = (r.height + 8) + "px";
        document.body.appendChild(box); return true })()`)
    },
    screenshot: async (options) => {
      const result = await send<{ data: string }>("Page.captureScreenshot", { format: options?.jpeg ? "jpeg" : "png", ...(options?.jpeg ? { quality: options.jpeg } : {}), captureBeyondViewport: !!options?.full }, sessionId)
      return Buffer.from(result.data, "base64")
    },
    read: async () => ({
      html: (await evaluate<string>("document.documentElement ? document.documentElement.outerHTML : ''")) ?? "",
      finalUrl: (await evaluate<string>("location.href").catch(() => "")) ?? "",
      title: (await evaluate<string>("document.title").catch(() => "")) ?? "",
    }),
    json: () => [...captured],
  }
}

export async function render(url: string, options: { timeoutMs: number; waitMs?: number; proxy?: string }): Promise<Rendered> {
  const deadline = Date.now() + options.timeoutMs
  const left = () => Math.max(500, deadline - Date.now())
  const browser = await launch({ timeoutMs: options.timeoutMs, ...(options.proxy ? { proxy: options.proxy } : {}) })
  try {
    const page = await browser.page()
    await page.navigate(url, Math.floor(left() * 0.7))
    await page.settle(Math.min(options.waitMs ?? 6000, Math.max(0, left() - 2500)))
    await page.evaluate("window.scrollTo(0, document.body ? document.body.scrollHeight : 0)").catch(() => undefined)
    await delay(Math.min(1200, Math.max(0, left() - 1500)))
    const read = await page.read()
    return { ...read, finalUrl: read.finalUrl || url }
  } finally {
    browser.close()
  }
}

/** Opens a page, runs `steps` (type, click, scroll as a person would), and returns the DOM plus the JSON the page fetched. */
export async function script(
  url: string,
  steps: (page: Page) => Promise<void>,
  options: { timeoutMs: number; waitMs?: number; profile?: string },
): Promise<Rendered & { json: Captured[] }> {
  const browser = await launch({ timeoutMs: options.timeoutMs, ...(options.profile ? { profile: options.profile } : {}) })
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Browser script timed out")), options.timeoutMs))
  try {
    return await Promise.race([
      (async () => {
        const page = await browser.page()
        await page.navigate(url, Math.floor(options.timeoutMs * 0.4))
        await page.settle(options.waitMs ?? 4000)
        await steps(page)
        await page.settle(options.waitMs ?? 4000)
        return { ...(await page.read()), json: page.json() }
      })(),
      timeout,
    ])
  } finally {
    browser.close()
  }
}
