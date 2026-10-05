import type { SessionMessageAssistant } from "@opencode/client/promise"

type Content = SessionMessageAssistant["content"][number]

// fork: tools whose output is the answer itself. Cards (maps, jobs, research, actions, scrape) always render on
// their own row; sources (web search/fetch) keep the preset's grouping in Code view. Both stay visible
// in Chat and Classifier views, which hide process tools such as read, grep, and shell.
const CARD_TOOLS = new Set([
  "maps_search",
  "maps_route",
  "jobs_search",
  "jobs_match",
  "research_status",
  "research_search",
  "research_classify",
  "research_shortlist",
  "action",
  "scrape_fetch",
  "scrape_status",
  "memory_search",
  "todo_write",
  "office_render",
])
const SOURCE_TOOLS = new Set(["websearch", "webfetch"])

export function timelineCardTool(content: Content) {
  return content.type === "tool" && CARD_TOOLS.has(content.name)
}

export function timelineResultTool(content: Content) {
  return content.type === "tool" && (CARD_TOOLS.has(content.name) || SOURCE_TOOLS.has(content.name))
}
