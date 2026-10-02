# Ultimate scraper (fork)

One tool for chat, code, and classifier: `scrape_fetch` tries an engine
chain in order and returns the first success with a warning trail.
`scrape_status` probes availability without network.

## Chain

| Mode | Chain |
| --- | --- |
| `fast` | `webfetch` |
| `stealth` | `camofox` → `scrapling` → `webfetch` |
| `ai` | `scrapegraph` → `webfetch` |
| `channels` | `agent-reach` → `webfetch` |
| `auto` | `webfetch` |

Every tier honors the same guards: http/https only (SSRF), per-tier
timeout, and the 5MB output bound. Failures are collected as warnings;
an empty output with `All scraper tiers failed` means nothing fetched.

## Engines (verified 2026-10-01, Windows, Python 3.12 + uv 0.12)

- `webfetch` — built-in Effect HttpClient path. Always ready.
- `scrapling` (`D4Vinci/Scrapling`, `uvx --from scrapling[fetchers]`,
  `Fetcher.get`) — **verified**: fetched `https://example.com` (200, 711B).
  Bridge: `packages/core/src/scrape/bridges/scrapling.py`. Note: the bridge
  file shadows the package name under `uvx --from`, so it strips its own
  directory from `sys.path` before `from scrapling import Fetcher`.
- `camofox` (`camoufox` python package via `uvx --from camoufox`, bridge
  `camofox_py.py`) — **verified**: headless anti-detect Firefox fetched
  `https://example.com` (200). The Firefox binary (~500MB) auto-downloads on
  first launch (`camoufox fetch`, cached in `%LOCALAPPDATA%/camoufox`).
  No Node/VS Build Tools needed. The `jo-inc/camofox-browser` node REST
  server (`:9377`) stays supported: set `OPENCODE_CAMOFOX_BACKEND=server`.
  Default `auto` tries server, then python.
- `scrapegraph` (`ScrapeGraphAI/Scrapegraph-ai`, pip name **`scrapegraphai`**
  no hyphen, `uvx --from scrapegraphai --with langchain-openai`) — installed
  **and import-verified**; needs an LLM key to run, else the tier skips
  honestly. Wiring: `OPENCODE_SCRAPEGRAPH_LLM` JSON
  (`{model,api_key,base_url}`) > `OPENAI_API_KEY`/`OPENAI_BASE_URL` >
  9router reuse (`OPENCODE_9ROUTER_API_KEY`, base `http://127.0.0.1:20128/v1`,
  model `opencode-9router`). Telemetry off
  (`SCRAPEGRAPHAI_TELEMETRY_ENABLED=false`).
- `agent-reach` (`Panniantong/agent-reach`, `uvx --from agent-reach`) —
  **verified**: `list` works, `get web <url> --json --no-cache` bridged.
  No channels installed yet (`doctor` → `No channels installed`), so the
  tier returns honest errors until the user installs one.

## Setup

Installs never run during render or server start. `scrape_status` and the
first `scrape_fetch` probe via `ScraperSetup.ensure`, which shells to
`uvx`/`npx` in the background. Kill switch: `OPENCODE_SCRAPER_NO_AUTOSETUP=1`.
Env: `OPENCODE_CAMOFOX_URL` (default `http://127.0.0.1:9377`),
`CAMOFOX_ACCESS_KEY`, `OPENCODE_SCRAPER_PYTHON` (reserved).
