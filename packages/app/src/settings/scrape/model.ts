// fork: Settings → Scraper. Ultimate scraper status, mode, and engine setup.
// Stage 1: fast tier (existing webfetch path) is always ready; stealth/AI/channels
// bridges are opt-in via auto-setup (uv + npm) behind the same scrape_fetch contract.
export const SCRAPE_ENGINES = ["webfetch", "scrapling", "camofox", "scrapegraph", "agent-reach"] as const
export type ScrapeEngineID = (typeof SCRAPE_ENGINES)[number]

export const SCRAPE_MODES = ["auto", "fast", "stealth", "ai", "channels"] as const
export type ScrapeModeID = (typeof SCRAPE_MODES)[number]

export const scrapeModeFrom = (value: unknown): ScrapeModeID =>
  (SCRAPE_MODES as readonly string[]).includes(value as string) ? (value as ScrapeModeID) : "auto"

export type ScrapeEngineState = {
  readonly engine: ScrapeEngineID
  readonly status: "ready" | "not_installed" | "installing" | "disabled" | "error"
  readonly message?: string
}

export const scrapeStatusLabel = (state: ScrapeEngineState) =>
  state.status === "ready"
    ? `${state.engine}: ready`
    : `${state.engine}: ${state.status}${state.message ? ` — ${state.message}` : ""}`

export const defaultScrapeStatus = (): ScrapeEngineState[] => [
  { engine: "webfetch", status: "ready" },
  { engine: "scrapling", status: "ready", message: "uvx scrapling[fetchers] — verified" },
  { engine: "camofox", status: "ready", message: "uvx camoufox python backend — verified (Firefox binary auto-fetch ~500MB)" },
  { engine: "scrapegraph", status: "not_installed", message: "uvx scrapegraphai — installed, needs LLM key (OPENCODE_SCRAPEGRAPH_LLM / OPENAI_API_KEY / 9router)" },
  { engine: "agent-reach", status: "ready", message: "uvx agent-reach — verified (no channels installed yet)" },
]
