export type ScrapeEngine = "webfetch" | "scrapling" | "camofox" | "scrapegraph" | "agent-reach" | "browser-proxy"

export type ScrapeMode = "fast" | "stealth" | "ai" | "channels" | "auto"

export type ScrapeInput = {
  readonly url: string
  readonly mode?: ScrapeMode
  readonly format?: "markdown" | "text" | "html" | "json"
  readonly timeoutMs?: number
  readonly waitMs?: number
  readonly proxy?: string
  readonly screenshot?: boolean
}

export type ScrapeOutput = {
  readonly url: string
  readonly finalUrl: string
  readonly engine: ScrapeEngine
  readonly format: string
  readonly output: string
  readonly title?: string
  readonly warnings: string[]
  readonly durationMs: number
  readonly bytes: number
}

export type EngineStatus = "ready" | "not_installed" | "installing" | "disabled" | "error"

export type ScrapeStatus = {
  readonly engines: Record<ScrapeEngine, { readonly status: EngineStatus; readonly message?: string }>
  readonly autoSetup: boolean
}
