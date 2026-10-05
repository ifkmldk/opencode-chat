export * as UltimateScrape from "./engine.js"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import fs from "node:fs"
import os from "node:os"
import path from "path"
import type { ScrapeInput, ScrapeOutput } from "./types.js"
import { NetGuard } from "../net-guard.js"
import { ScrapeChromium } from "./chromium.js"
import { ScrapeExtract } from "./extract.js"
import camofoxBridge from "./bridges/camofox_py.py.txt" with { type: "text" }
import scraplingBridge from "./bridges/scrapling.py.txt" with { type: "text" }
import scrapegraphBridge from "./bridges/scrapegraph.py.txt" with { type: "text" }
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
  prompt: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))).annotate({ description: "mode \"ai\" only: what to extract, e.g. \"every job opening with title, location and apply link as JSON\"." }),
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
      return ["chromium", "camofox", "scrapling", "webfetch", "scrapegraph"]
    case viaAI:
      return ["scrapegraph", "webfetch"]
    case viaChannels:
      return ["agent-reach", "webfetch"]
    // fork: auto escalates from a plain GET to a rendering browser when the page comes back empty, blocked or a shell,
    // and as a last resort lets ScrapeGraphAI (an LLM reading the rendered page) extract what the others could not.
    default:
      return ["webfetch", "chromium", "scrapegraph"]
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
// fork: the bridge scripts are embedded in the executable (a compiled build has no source folder next to it, which is why
// every Python tier failed with "can't open file B:\~BUN\root\bridges"). They are written to a cache folder on use.
const BRIDGES = { "scrapling.py": scraplingBridge, "camofox_py.py": camofoxBridge, "scrapegraph.py": scrapegraphBridge } as const
export const bridgeFile = (name: keyof typeof BRIDGES) => {
  const directory = path.join(process.env.OPENCODE_SCRAPER_DIR ?? path.join(os.homedir(), ".local", "share", "opencode"), "scrape-bridges")
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== BRIDGES[name]) fs.writeFileSync(file, BRIDGES[name])
  return file
}

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
  // fork: markdown/text keep the main content (menus, banners and footers dropped) and add structured JobPosting data.
  const main = ScrapeExtract.mainContent(html)
  const jobs = format === "markdown" ? ScrapeExtract.jobPostingsMarkdown(ScrapeExtract.jobPostings(html)) : ""
  const body = format === "html" ? html : format === "text" ? extractTextFromHTML(main) : convertHTMLToMarkdown(main)
  const output = jobs ? `${body}

${jobs}` : body
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
      ["--from", "scrapling[fetchers]", "python", bridgeFile("scrapling.py")],
      JSON.stringify({ url: input.url, timeout_ms: timeoutMs, proxy: input.proxy }),
      timeoutMs + 30_000,
    )
    const parsed = JSON.parse(out) as { ok: boolean; html?: string; final_url?: string; error?: string }
    if (!parsed.ok || !parsed.html) throw new Error(parsed.error ?? "Scrapling returned no HTML")
    return toOutput(input, parsed.html, "scrapling", parsed.final_url ?? input.url, started)
  })

const fetchChromium = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 45_000, 5000), 120_000)
    const page = yield* Effect.tryPromise({
      try: () => ScrapeChromium.render(input.url, { timeoutMs, waitMs: input.waitMs, proxy: input.proxy }),
      catch: (error) => error,
    })
    return toOutput(input, page.html, "chromium", page.finalUrl, started)
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
      ["--from", CAMOFOX_PY_SPEC, "python", bridgeFile(CAMOFOX_PY_BRIDGE)],
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
// without a new key. Env first, then the owner's opencode.json.
const scrapegraphProviderFromEnv = () => {
  const fromConfig = nineRouterFromConfig()
  const baseURL = process.env.OPENCODE_9ROUTER_BASE_URL ?? fromConfig?.baseURL ?? "http://127.0.0.1:20128/v1"
  const apiKey = process.env.OPENCODE_9ROUTER_API_KEY ?? fromConfig?.apiKey
  const model = process.env.OPENCODE_SCRAPEGRAPH_MODEL ?? fromConfig?.model ?? "opencode-9router"
  return { baseURL, ...(apiKey ? { apiKey } : {}), model }
}

// fork: the owner keeps the 9router key in opencode.json (provider "9router"), not in the environment. Read it there,
// in this process only; it goes to the bridge on stdin and is never logged or put in the bridge's environment.
const nineRouterFromConfig = () => {
  const dir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "opencode") : path.join(os.homedir(), ".config", "opencode")
  const file = ["opencode.json", "opencode.jsonc"].map((name) => path.join(dir, name)).find((candidate) => fs.existsSync(candidate))
  if (!file) return undefined
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "")) as { provider?: Record<string, { options?: { baseURL?: string; apiKey?: string }; models?: Record<string, unknown> }> }
    const provider = config.provider?.["9router"]
    if (!provider?.options?.apiKey || provider.options.apiKey.startsWith("{env:")) return undefined
    return { baseURL: provider.options.baseURL, apiKey: provider.options.apiKey, model: Object.keys(provider.models ?? {})[0] }
  } catch {
    return undefined
  }
}

const fetchScrapegraph = (input: ScrapeInput, started: number) =>
  Effect.gen(function* () {
    assertHttpUrl(input.url)
    // As the last automatic tier it installs Python packages on first use, so it follows the same switch as the other bridges.
    if (input.mode !== "ai" && process.env.OPENCODE_SCRAPER_NO_AUTOSETUP === "1") return yield* Effect.fail(new Error("scrapegraph tier is off (OPENCODE_SCRAPER_NO_AUTOSETUP=1)"))
    // fork: resolve LLM without reading disk here (caller passes provider).
    // Without a key the tier skips fast — no wasted download or LLM bill.
    const llm = resolveScrapegraphLLM({ provider: scrapegraphProviderFromEnv() })
    if (!llm?.apiKey) return yield* Effect.fail(new Error("Scrapegraph needs an LLM key: set OPENCODE_SCRAPEGRAPH_LLM or OPENAI_API_KEY (9router reuse supported)"))
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 120_000, 5000), 180_000)
    // ScrapeGraphAI's own loader often gets an empty shell from script-built pages; give it the page our browser
    // tier already rendered, so the LLM extracts from what a person would see.
    const rendered = ScrapeChromium.available()
      ? yield* Effect.promise(() => ScrapeChromium.render(input.url, { timeoutMs: 45_000, waitMs: 4000 }).catch(() => undefined))
      : undefined
    const out = yield* runBridge(
      "uvx",
      ["--from", SPEC_SCRAPEGRAPH, "--with", SPEC_SCRAPEGRAPH_WITH, "python", bridgeFile("scrapegraph.py")],
      JSON.stringify({
        url: input.url,
        ...(rendered && rendered.html.length > 500 ? { html: ScrapeExtract.mainContent(rendered.html).slice(0, 400_000) } : {}),
        prompt: input.prompt ?? "Extract the main content as markdown.",
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
    case "chromium":
      return fetchChromium(input, started)
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
    // fork: public destinations only (see net-guard.ts); a refusal is returned as the failure, with its reason.
    const refused = yield* Effect.tryPromise({ try: () => NetGuard.assertPublicUrl(input.url), catch: (error) => error }).pipe(Effect.result)
    if (refused._tag === "Failure") return { ...stubOutput(input), warnings: ["All scraper tiers failed.", (refused.failure as Error).message] }
    const warnings: string[] = []
    let best: ScrapeOutput | undefined
    for (const tier of planFor(input)) {
      const attempt = yield* tierFor(tier, http, input, started).pipe(Effect.result)
      if (attempt._tag === "Failure") {
        warnings.push(`${tier}: ${(attempt.failure as Error)?.message ?? String(attempt.failure)}`.slice(0, 300))
        continue
      }
      // fork: a page that loaded but is empty, a menu stub or a bot wall is not a result: try the next tier, keep the best.
      if (input.format === "html" || ScrapeExtract.isUseful(attempt.success.output)) return { ...attempt.success, warnings: [...warnings, ...attempt.success.warnings] }
      warnings.push(`${tier}: empty, blocked or script-only page (${attempt.success.output.trim().length} characters)`)
      if (!best || attempt.success.output.length > best.output.length) best = attempt.success
    }
    if (best && best.output.trim().length > 0) return { ...best, warnings: ["The page text is short or looks blocked; treat it as incomplete.", ...warnings] }
    return { ...stubOutput(input), warnings: ["All scraper tiers failed.", ...warnings] }
  })

export const __test = { planFor, bridgeFile, stubOutput, assertHttpUrl, toOutput, scrapegraphProviderFromEnv }


