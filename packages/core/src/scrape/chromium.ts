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

export async function render(url: string, options: { timeoutMs: number; waitMs?: number; proxy?: string }): Promise<Rendered> {
  const browser = available()
  if (!browser) throw new Error("No Chromium-based browser (Playwright Chromium, Chrome or Brave) was found on this computer.")
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-scrape-"))
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
      "--disable-blink-features=AutomationControlled",
      `--user-data-dir=${profile}`,
      `--user-agent=${USER_AGENT}`,
      ...(options.proxy ? [`--proxy-server=${options.proxy}`] : []),
      "about:blank",
    ],
    { windowsHide: true },
  )
  const deadline = Date.now() + options.timeoutMs
  const left = () => Math.max(500, deadline - Date.now())
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let text = ""
      const timer = setTimeout(() => reject(new Error("Chromium did not start")), Math.min(15_000, left()))
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
        reject(new Error("Chromium exited before it was ready"))
      })
    })
    const socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("Could not connect to Chromium"))
    })
    let counter = 0
    const pending = new Map<number, Pending>()
    const waiters: Array<{ method: string; sessionId?: string; resolve: () => void }> = []
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; sessionId?: string }
      if (message.id !== undefined) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) entry?.reject(new Error(message.error.message))
        else entry?.resolve(message.result)
        return
      }
      waiters.filter((item) => item.method === message.method && item.sessionId === message.sessionId).forEach((item) => item.resolve())
    }
    const send = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
      new Promise<T>((resolve, reject) => {
        const id = ++counter
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    const event = (method: string, sessionId: string, within: number) =>
      new Promise<void>((resolve) => {
        waiters.push({ method, sessionId, resolve })
        setTimeout(resolve, within)
      })

    const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
    await send("Page.enable", {}, sessionId)
    const loaded = event("Page.loadEventFired", sessionId, Math.floor(left() * 0.7))
    await send("Page.navigate", { url }, sessionId)
    await loaded
    // Let client-side rendering settle, scroll once for lazy lists, settle again.
    // Wait until the page text stops growing (client-side lists arrive after the load event), at most `waitMs`.
    const settleUntil = Date.now() + Math.min(options.waitMs ?? 6000, Math.max(0, left() - 2500))
    let last = -1
    let steady = 0
    while (Date.now() < settleUntil && steady < 2) {
      await delay(700)
      const size = await send<{ result: { value?: number } }>("Runtime.evaluate", { expression: "document.body ? document.body.innerText.length : 0", returnByValue: true }, sessionId)
        .then((result) => result.result.value ?? 0)
        .catch(() => -1)
      steady = size === last ? steady + 1 : 0
      last = size
    }
    await send("Runtime.evaluate", { expression: "window.scrollTo(0, document.body ? document.body.scrollHeight : 0)" }, sessionId).catch(() => undefined)
    await delay(Math.min(1200, Math.max(0, left() - 1500)))
    const read = async (expression: string) => {
      const result = await send<{ result: { value?: string } }>("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
      return result.result.value ?? ""
    }
    const html = await read("document.documentElement ? document.documentElement.outerHTML : ''")
    const finalUrl = (await read("location.href").catch(() => url)) || url
    const title = await read("document.title").catch(() => "")
    socket.close()
    return { html, finalUrl, title }
  } finally {
    killTree(child.pid)
    removeProfile(profile)
  }
}
