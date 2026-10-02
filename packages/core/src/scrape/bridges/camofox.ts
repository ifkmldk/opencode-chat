// fork: camofox bridge for the ultimate scraper.
//
// Two backends behind one contract:
// - "server": jo-inc/camofox-browser REST server (default :9377).
// - "python": camoufox package via `uvx --from camoufox` (no Node/VS needed).
// OPENCODE_CAMOFOX_BACKEND selects "auto" (default), "server", or "python".
import type { ScrapeInput } from "../types.js"

export const DEFAULT_URL = "http://127.0.0.1:9377"
export const serverUrl = (env: NodeJS.ProcessEnv = process.env) =>
  env.OPENCODE_CAMOFOX_URL ?? env.CAMOFOX_URL ?? DEFAULT_URL

export const backend = (env: NodeJS.ProcessEnv = process.env): "auto" | "server" | "python" => {
  const raw = (env.OPENCODE_CAMOFOX_BACKEND ?? "auto").toLowerCase()
  return raw === "server" || raw === "python" ? raw : "auto"
}

export const healthUrl = (env: NodeJS.ProcessEnv = process.env) => `${serverUrl(env).replace(/\/$/, "")}/health`

export const PYTHON_SPEC = "camoufox"
export const PYTHON_BRIDGE = "camofox_py.py"

export const authHeaders = (env: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const key = env.CAMOFOX_ACCESS_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
}

export const fetchPayload = (input: ScrapeInput) => ({
  url: input.url,
  waitMs: input.waitMs ?? 3000,
  proxy: input.proxy,
  screenshot: input.screenshot ?? false,
})

export const pythonPayload = (input: ScrapeInput, timeoutMs: number) => ({
  url: input.url,
  timeout_ms: timeoutMs,
  wait_ms: input.waitMs ?? 3000,
  proxy: input.proxy,
  headless: true,
})

export const parseResult = (url: string, value: unknown): { html: string; finalUrl: string; title?: string } => {
  const record = (value ?? {}) as Record<string, unknown>
  const html = typeof record.html === "string" ? record.html : typeof record.content === "string" ? record.content : ""
  const finalUrl = typeof record.finalUrl === "string" ? record.finalUrl : typeof record.url === "string" ? record.url : url
  const title = typeof record.title === "string" ? record.title : undefined
  if (!html) throw new Error("Camofox returned no HTML")
  return { html, finalUrl, ...(title ? { title } : {}) }
}
