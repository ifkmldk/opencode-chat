// fork: agent-reach bridge for the ultimate scraper.
//
// agent-reach (Panniantong/agent-reach) is a channel router: `get <channel>`
// reads pages through whichever backend `doctor` selected (Jina Reader,
// browser login sessions, yt-dlp, gh CLI, feedparser...). This bridge shells
// to `agent-reach get web <url> --json` under `uvx --from agent-reach` and
// normalizes the output. Credentials stay in ~/.agent-reach/config.yaml (600)
// and are never passed through here.
import type { ScrapeInput } from "../types.js"

export const SPEC = "agent-reach"

export const argsFor = (input: ScrapeInput) => ["get", "web", input.url, "--json", "--no-cache"]

export const parseResult = (url: string, stdout: string): { output: string; finalUrl: string } => {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error("agent-reach returned no output")
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const text =
      typeof parsed.content === "string"
        ? parsed.content
        : typeof parsed.text === "string"
          ? parsed.text
          : typeof parsed.result === "string"
            ? parsed.result
            : ""
    if (!text) throw new Error("agent-reach returned no content")
    const finalUrl = typeof parsed.url === "string" ? parsed.url : url
    return { output: text, finalUrl }
  } catch (error) {
    if (error instanceof Error && error.message.includes("no content")) throw error
    return { output: trimmed, finalUrl: url }
  }
}
