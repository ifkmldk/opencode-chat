export * as UltimateScrape from "./engine.js"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { fileURLToPath } from "url"
import path from "path"
import type { ScrapeInput, ScrapeOutput } from "./types.js"
import { convertHTMLToMarkdown, MAX_MARKDOWN_BYTES } from "../tool/html-markdown.js"
import { collectBoundedResponseBody } from "../tool/http-body.js"
import { extractTextFromHTML } from "../tool/plugin/webfetch.js"
import { argsFor as agentReachArgs, parseResult as parseAgentReach, SPEC as SPEC_AGENT_REACH } from "./bridges/agent-reach.js"
import {
  authHeaders,
  backend as camofoxBackend,
  fetchPayload,
  healthUrl as camofoxHealthUrl,
  parseResult as parseCamofox,
  PYTHON_BRIDGE as CAMOFOX_PY_BRIDGE,
  PYTHON_SPEC as CAMOFOX_PY_SPEC,
  pythonPayload as camofoxPythonPayload,
  serverUrl,
} from "./bridges/camofox.js"
import { SPEC_AGENT_REACH as SETUP_AGENT_REACH, SPEC_CAMOUFOX, SPEC_SCRAPEGRAPH, SPEC_SCRAPEGRAPH_WITH, SPEC_SCRAPLING, resolveScrapegraphLLM } from "./setup.js"

export const Input = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(2000)),
  mode: Schema.optional(Schema.Literals(["fast", "stealth", "ai", "channels", "auto"])),
  format: Schema.optional(Schema.Literals(["markdown", "text", "html", "json"])),
  timeoutMs: Schema.optional(Schema.Number),
  waitMs: Schema.optional(Schema.Number),
  proxy: Schema.optional(Schema.String),
  screenshot: Schema.optional(Schema.Boolean),
})

export const Output = Schema.Struct({
  url: Schema.String,
  finalUrl: Schema.String,
  engine: Schema.String,
  format: Schema.String,
  output: Schema.String,
  title: Schema.optional(Schema.String),
  warnings: Schema.Array(Schema.String),
  durationMs: Schema.Number,
  bytes: Schema.Number,
})

const viaWebfetch = "fast"
const viaStealth = "stealth"
const viaAI = "ai"
const viaChannels = "channels"

// fork: ultimate scraper orchestration. Stage 2 wires every tier behind the
// same input/output contract, so chat/code/classifier callers never change.
export const planFor = (input: { mode?: string }): string[] => {
  switch (input.mode ?? "auto") {
    case viaWebfetch:
      return ["webfetch"]
    case viaStealth:
      return ["camofox", "scrapling", "webfetch"]
    case viaAI:
      return ["scrapegraph", "webfetch"]
    case viaChannels:
      return ["agent-reach", "webfetch"]
    default:
      return ["webfetch"]
  }
}

export const stubOutput = (input: ScrapeInput): ScrapeOutput => ({
  url: input.url,
  finalUrl: input.url,
  engine: "webfetch",
  format: input.format ?? "markdown",
  output: "",
  warnings: ["Ultimate scraper stage 1: only the fast tier is wired. Stealth/AI/channels bridges are planned."],
  durationMs: 0,
  bytes: 0,
})

const MAX_BYTES = MAX_MARKDOWN_BYTES
const bridgesDir = path.dirname(fileURLToPath(import.meta.url))

const titleOf = (html: string) => /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]?.trim()

const toOutput = (
  input: ScrapeInput,
  html: string,
  engine: ScrapeOutput["engine"],
  finalUrl: string,
  started: number,
  extraWarnings: string[] = [],
): ScrapeOutput => {
  const format = input.format ?? "markdown"
  const output = format === "html" ? html : format === "text" ? extractTextFromHTML(html) : convertHTMLToMarkdown(html)
  const bytes = new TextEncoder().encode(output).byteLength
  return {
    url: input.url,
    finalUrl,
    engine,
    format,
    output,
    ...(titleOf(html) ? { title: titleOf(html) } : {}),
    warnings: extraWarnings,
    durationMs: Date.now() - started,
    bytes,
  }
}

const assertHttpUrl = (raw: string) => {
  const parsed = new URL(raw)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("URL must use http:// or https://")
  return parsed
}

const runBridge = (command: string, args: string[], stdin: string, timeoutMs: number) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([command, ...args], { stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" })
      const done = await Promise.race([
        proc.exited.then((code) => ({ code })),
        new Promise<{ code: number }>((resolve) => setTimeout(() => resolve({ code: -1 }), timeoutMs)),
      ])
      const out = await new Response(proc.stdout).text()
      const err = await new Response(proc.stderr).text()
      if (done.code !== 0) throw new Error((err || out || `bridge exited with code ${done.code}`).slice(0, 2000))
      return out
    },
    catch: (error) => error,
  })

const fetchScrapling = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 60_000, 5000), 120_000)
    const out = yield* runBridge(
      "uvx",
      ["--from", "scrapling[fetchers]", "python", path.join(bridgesDir, "bridges", "scrapling.py")],
      JSON.stringify({ url: input.url, timeout_ms: timeoutMs, proxy: input.proxy }),
      timeoutMs + 30_000,
    )
    const parsed = JSON.parse(out) as { ok: boolean; html?: string; final_url?: string; error?: string }
    if (!parsed.ok || !parsed.html) throw new Error(parsed.error ?? "Scrapling returned no HTML")
    return toOutput(input, parsed.html, "scrapling", parsed.final_url ?? input.url, started)
  })

const fetchAgentReach = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 60_000, 5000), 120_000)
    const out = yield* runBridge("uvx", ["--from", SPEC_AGENT_REACH, ...agentReachArgs(input)], "", timeoutMs + 30_000)
    const parsed = parseAgentReach(input.url, out)
    const format = input.format ?? "markdown"
    return {
      url: input.url,
      finalUrl: parsed.finalUrl,
      engine: "agent-reach" as const,
      format,
      output: parsed.output.slice(0, MAX_BYTES),
      warnings: [],
      durationMs: Date.now() - started,
      bytes: new TextEncoder().encode(parsed.output).byteLength,
    }
  })

const fetchCamofoxServer = (input: ScrapeInput, started: number, timeoutMs: number) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${serverUrl()}/fetch`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(fetchPayload(input)),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      catch: (error) => error,
    })
    if (!response.ok) throw new Error(`Camofox server returned HTTP ${response.status}`)
    const parsed = parseCamofox(
      input.url,
      yield* Effect.tryPromise({ try: () => response.json(), catch: (error) => error }),
    )
    return toOutput(input, parsed.html, "camofox", parsed.finalUrl, started)
  })

const fetchCamofoxPython = (input: ScrapeInput, started: number, timeoutMs: number) =>
  Effect.gen(function* () {
    const out = yield* runBridge(
      "uvx",
      ["--from", CAMOFOX_PY_SPEC, "python", path.join(bridgesDir, "bridges", CAMOFOX_PY_BRIDGE)],
      JSON.stringify(camofoxPythonPayload(input, timeoutMs)),
      timeoutMs + 60_000,
    )
    const parsed = JSON.parse(out) as { ok: boolean; html?: string; final_url?: string; error?: string }
    if (!parsed.ok || !parsed.html) throw new Error(parsed.error ?? "Camofox python returned no HTML")
    return toOutput(input, parsed.html, "camofox", parsed.final_url ?? input.url, started)
  })

const fetchCamofox = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 90_000, 5000), 180_000)
    const mode = camofoxBackend()
    const errors: string[] = []
    // fork: server first when selected (or auto), then python-local workaround.
    if (mode !== "python") {
      const server = yield* fetchCamofoxServer(input, started, timeoutMs).pipe(Effect.result)
      if (server._tag === "Success") return server.success
      errors.push(`server: ${(server.failure as Error)?.message ?? String(server.failure)}`.slice(0, 200))
    }
    if (mode !== "server") {
      const python = yield* fetchCamofoxPython(input, started, timeoutMs).pipe(Effect.result)
      if (python._tag === "Success")
        return { ...python.success, warnings: [...errors, "camofox python backend (no VS Build Tools needed)"] }
      errors.push(`python: ${(python.failure as Error)?.message ?? String(python.failure)}`.slice(0, 200))
    }
    // fork: a failure, not a throw: a throw inside Effect.gen is a defect, which skipped the remaining scraper
    // tiers (run() only catches failures) and crashed the caller.
    return yield* Effect.fail(
      new Error(`Camofox unavailable (${errors.join("; ") || "no backend tried"}). Set OPENCODE_CAMOFOX_BACKEND=server|python.`),
    )
  })

// fork: 9router is an OpenAI-compatible gateway (see opencode.json provider
// "9router" -> http://127.0.0.1:20128/v1). Reuse it so scrapegraph works
// without a new key. Reads env only — the caller may inject provider config.
const scrapegraphProviderFromEnv = () => {
  const baseURL = process.env.OPENCODE_9ROUTER_BASE_URL ?? "http://127.0.0.1:20128/v1"
  const apiKey = process.env.OPENCODE_9ROUTER_API_KEY
  const model = process.env.OPENCODE_SCRAPEGRAPH_MODEL ?? "opencode-9router"
  return { baseURL, ...(apiKey ? { apiKey } : {}), model }
}

const fetchScrapegraph = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    // fork: resolve LLM without reading disk here (caller passes provider).
    // Without a key the tier skips fast — no wasted download or LLM bill.
    const llm = resolveScrapegraphLLM({ provider: scrapegraphProviderFromEnv() })
    if (!llm?.apiKey) throw new Error("Scrapegraph needs an LLM key: set OPENCODE_SCRAPEGRAPH_LLM or OPENAI_API_KEY (9router reuse supported)")
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 120_000, 5000), 180_000)
    const out = yield* runBridge(
      "uvx",
      ["--from", SPEC_SCRAPEGRAPH, "--with", SPEC_SCRAPEGRAPH_WITH, "python", path.join(bridgesDir, "bridges", "scrapegraph.py")],
      JSON.stringify({
        url: input.url,
        prompt: "Extract the main content as markdown.",
        llm: { model: llm.model, api_key: llm.apiKey, base_url: llm.baseURL },
      }),
      timeoutMs + 30_000,
    )
    const parsed = JSON.parse(out) as { ok: boolean; result?: unknown; error?: string }
    if (!parsed.ok) throw new Error(parsed.error ?? "Scrapegraph returned no result")
    const text = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result)
    return {
      url: input.url,
      finalUrl: input.url,
      engine: "scrapegraph" as const,
      format: "markdown",
      output: text.slice(0, MAX_BYTES),
      warnings: [],
      durationMs: Date.now() - started,
      bytes: new TextEncoder().encode(text).byteLength,
    }
  })

export const fetchWeb = (http: HttpClient.HttpClient, input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1000), 120_000)
    const response = yield* http
      .execute(
        HttpClientRequest.get(input.url).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OpenCode-User/1.0; +https://opencode.ai",
            Accept: "text/markdown;q=1.0, text/html;q=0.7, */*;q=0.1",
            "Accept-Language": "en-US,en;q=0.9",
          }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeoutOrElse({
          duration: Duration.millis(timeoutMs),
          orElse: () => Effect.fail(new Error("Request timed out")),
        }),
      )
    const contentType = response.headers["content-type"] || ""
    if (contentType && !/text\/|json|xml|javascript/.test(contentType)) throw new Error(`Unsupported content type: ${contentType}`)
    const body = yield* collectBoundedResponseBody(response, MAX_BYTES, () => new Error("Response too large"))
    return toOutput(input, new TextDecoder().decode(body), "webfetch", input.url, started)
  })

const tierFor = (name: string, http: HttpClient.HttpClient, input: ScrapeInput, started: number) => {
  switch (name) {
    case "camofox":
      return fetchCamofox(input, started)
    case "scrapling":
      return fetchScrapling(input, started)
    case "scrapegraph":
      return fetchScrapegraph(input, started)
    case "agent-reach":
      return fetchAgentReach(input, started)
    default:
      return fetchWeb(http, input, started)
  }
}

export const run = (http: HttpClient.HttpClient, input: ScrapeInput) =>
  Effect.gen(function* () {
    const started = Date.now()
    const warnings: string[] = []
    for (const tier of planFor(input)) {
      const attempt = yield* tierFor(tier, http, input, started).pipe(Effect.result)
      if (attempt._tag === "Success") return { ...attempt.success, warnings: [...warnings, ...attempt.success.warnings] }
      warnings.push(`${tier}: ${(attempt.failure as Error)?.message ?? String(attempt.failure)}`.slice(0, 300))
    }
    return { ...stubOutput(input), warnings: ["All scraper tiers failed.", ...warnings] }
  })

export const __test = { planFor, stubOutput, assertHttpUrl, toOutput, scrapegraphProviderFromEnv }


