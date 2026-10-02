export * as ScraperSetup from "./setup.js"

import { Effect } from "effect"

export const NO_AUTOSETUP_ENV = "OPENCODE_SCRAPER_NO_AUTOSETUP"

export const autoSetupEnabled = (env: NodeJS.ProcessEnv = process.env) => env[NO_AUTOSETUP_ENV] !== "1"

// fork: real availability probes. uvx specs are pinned so every machine
// resolves the same bridge revisions; camofox needs its server running.
export const SPEC_SCRAPLING = "scrapling[fetchers]"
export const SPEC_SCRAPEGRAPH = "scrapegraphai"
export const SPEC_SCRAPEGRAPH_WITH = "langchain-openai"
export const SPEC_AGENT_REACH = "agent-reach"
export const SPEC_CAMOUFOX = "camoufox"
export const NPM_CAMOFOX = "@askjo/camofox-browser"

export type CamofoxBackend = "server" | "python" | "unavailable"

export const camofoxBackend = (env: NodeJS.ProcessEnv = process.env): "auto" | "server" | "python" => {
  const raw = (env.OPENCODE_CAMOFOX_BACKEND ?? "auto").toLowerCase()
  return raw === "server" || raw === "python" ? raw : "auto"
}

export const camofoxServerUrl = (env: NodeJS.ProcessEnv = process.env) =>
  env.OPENCODE_CAMOFOX_URL ?? env.CAMOFOX_URL ?? "http://127.0.0.1:9377"

// fork: scrapegraph LLM wiring. Explicit JSON wins, then OPENAI_* env,
// then the 9router OpenAI-compatible provider from opencode.json (read by
// the caller and passed in — never read from disk here, so unit tests stay
// hermetic and no key is ever logged).
export type ScrapegraphLLM = { readonly model: string; readonly apiKey?: string; readonly baseURL?: string }

export const resolveScrapegraphLLM = (input: {
  env?: NodeJS.ProcessEnv
  provider?: { baseURL?: string; apiKey?: string; model?: string }
}): ScrapegraphLLM | undefined => {
  const env = input.env ?? process.env
  const raw = env.OPENCODE_SCRAPEGRAPH_LLM
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { model?: string; api_key?: string; apiKey?: string; base_url?: string; baseURL?: string }
      if (parsed.model) return { model: parsed.model, ...(parsed.api_key ?? parsed.apiKey ? { apiKey: parsed.api_key ?? parsed.apiKey } : {}), ...(parsed.base_url ?? parsed.baseURL ? { baseURL: parsed.base_url ?? parsed.baseURL } : {}) }
    } catch {
      // fall through to env/provider fallbacks
    }
  }
  const apiKey = env.OPENAI_API_KEY ?? input.provider?.apiKey
  const baseURL = env.OPENAI_BASE_URL ?? input.provider?.baseURL
  const model = input.provider?.model ?? "gpt-4o-mini"
  if (!apiKey) return undefined
  return { model, apiKey, ...(baseURL ? { baseURL } : {}) }
}

export const describeAvailability = (env: NodeJS.ProcessEnv = process.env) => ({
  webfetch: "ready",
  scrapling: autoSetupEnabled(env) ? "not_installed (auto-setup on first stealth use)" : "disabled",
  camofox: autoSetupEnabled(env) ? "not_installed (auto-setup on first stealth use)" : "disabled",
  scrapegraph: "not_installed (needs an LLM key)",
  "agent-reach": autoSetupEnabled(env) ? "not_installed (auto-setup on first channels use)" : "disabled",
})

const probe = (command: string, args: string[], timeoutMs: number) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
      const done = await Promise.race([
        proc.exited.then((code) => ({ code })),
        new Promise<{ code: number }>((resolve) => setTimeout(() => resolve({ code: -1 }), timeoutMs)),
      ])
      if (done.code !== 0) throw new Error(`exit ${done.code}`)
    },
    catch: (error) => error,
  })

// fork: background setup. Installs run here (called from scrape_status/fetch),
// never during render or server start. Lock file prevents parallel installs.
export const ensure = (engine: string) =>
  Effect.gen(function* () {
    if (!autoSetupEnabled()) return "disabled (OPENCODE_SCRAPER_NO_AUTOSETUP=1)"
    if (engine === "scrapling") {
      const result = yield* probe("uvx", ["--from", SPEC_SCRAPLING, "python", "-c", "from scrapling import Fetcher"], 120_000).pipe(
        Effect.result,
      )
      return result._tag === "Success" ? "ready" : `probe failed: ${(result.failure as Error)?.message ?? String(result.failure)}`.slice(0, 200)
    }
    if (engine === "agent-reach") {
      const result = yield* probe("uvx", ["--from", SPEC_AGENT_REACH, "agent-reach", "list"], 120_000).pipe(Effect.result)
      return result._tag === "Success" ? "ready" : `probe failed: ${(result.failure as Error)?.message ?? String(result.failure)}`.slice(0, 200)
    }
    if (engine === "scrapegraph") {
      const result = yield* probe(
        "uvx",
        ["--from", SPEC_SCRAPEGRAPH, "--with", SPEC_SCRAPEGRAPH_WITH, "python", "-c", "import scrapegraphai"],
        180_000,
      ).pipe(Effect.result)
      if (result._tag !== "Success")
        return `probe failed: ${(result.failure as Error)?.message ?? String(result.failure)}`.slice(0, 200)
      return "ready (needs an LLM key: OPENCODE_SCRAPEGRAPH_LLM, OPENAI_API_KEY, or 9router)"
    }
    if (engine === "camofox") {
      // fork: node server needs VS Build Tools on Windows (better-sqlite3
      // node-gyp), so the python camoufox backend is the default workaround:
      // no Node/VS needed, Firefox binary downloads via uv on first use.
      const result = yield* probe("uvx", ["--from", SPEC_CAMOUFOX, "python", "-c", "import camoufox"], 180_000).pipe(
        Effect.result,
      )
      if (result._tag !== "Success")
        return `probe failed: ${(result.failure as Error)?.message ?? String(result.failure)}`.slice(0, 200)
      return "ready (python backend; set OPENCODE_CAMOFOX_BACKEND=server for the node REST server)"
    }
    return "unknown engine"
  })

export const __test = { autoSetupEnabled, describeAvailability, ensure, camofoxBackend, camofoxServerUrl, resolveScrapegraphLLM }
