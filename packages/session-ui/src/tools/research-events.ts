/** Shared browser-event contract and pure helpers for interactive research/maps output.
 * Lives in session-ui (not app) because tool-renderer needs it and session-ui
 * cannot import from app. The app listens for RESEARCH_ASK_CHAT_EVENT and
 * prefills the composer; the model then calls research_shortlist/action tools
 * itself so permissions and approval gates stay intact. */
export const RESEARCH_ASK_CHAT_EVENT = "opencode:research-ask-chat"

export type ResearchSearchInput = {
  query: string
  category: string
  location?: string
  budget?: string
}

/** Prefill text asking Chat to run research_search with budget/location filters. */
export function researchSearchPrompt(input: ResearchSearchInput) {
  const lines = [
    `Use the research tools (research_search) to find the best ${input.category} options for: ${input.query}.`,
  ]
  if (input.location?.trim()) lines.push(`Location: ${input.location.trim()}.`)
  if (input.budget?.trim()) lines.push(`Budget: ${input.budget.trim()}.`)
  lines.push(
    "Compare price, quality, rating, availability, and tradeoffs. Return an explainable shortlist with sources. Do not book, buy, apply, or submit anything without explicit approval.",
  )
  return lines.join(" ")
}

export function requestResearchAskChat(text: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(RESEARCH_ASK_CHAT_EVENT, { detail: { text } }))
}

export function readResearchAskChatDetail(event: Event): { text: string } | undefined {
  if (typeof CustomEvent !== "undefined" && !(event instanceof CustomEvent)) return undefined
  const detail: unknown = (event as CustomEvent).detail
  if (!detail || typeof detail !== "object") return undefined
  const text = "text" in detail ? detail.text : undefined
  if (typeof text !== "string" || !text.trim()) return undefined
  return { text }
}

/** Read-only OpenStreetMap embed for a single point. No API key needed. */
export function mapEmbedUrl(latitude: number, longitude: number, span = 0.05) {
  const bbox = `${longitude - span},${latitude - span},${longitude + span},${latitude + span}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`
}

export type MapPoint = { latitude: number; longitude: number }

/** Read-only OSM embed framing both route endpoints. No API key needed. */
export function routeEmbedUrl(origin: MapPoint, destination: MapPoint) {
  const west = Math.min(origin.longitude, destination.longitude) - 0.05
  const south = Math.min(origin.latitude, destination.latitude) - 0.05
  const east = Math.max(origin.longitude, destination.longitude) + 0.05
  const north = Math.max(origin.latitude, destination.latitude) + 0.05
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west},${south},${east},${north}&layer=mapnik&marker=${destination.latitude},${destination.longitude}`
}

export function formatRouteMeta(distanceMeters: unknown, durationSeconds: unknown) {
  const distance = typeof distanceMeters === "number" && Number.isFinite(distanceMeters) ? distanceMeters : undefined
  const duration = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) ? durationSeconds : undefined
  const km = distance !== undefined ? Math.round(distance / 100) / 10 : undefined
  const minutes = duration !== undefined ? Math.round(duration / 60) : undefined
  return [km !== undefined ? `${km} km` : undefined, minutes !== undefined ? `${minutes} min` : undefined]
    .filter(Boolean)
    .join(" · ")
}

export type ResearchCandidateLike = {
  id?: unknown
  category?: unknown
  title?: unknown
  url?: unknown
  summary?: unknown
  provider?: unknown
  price?: unknown
  currency?: unknown
  rating?: unknown
  location?: unknown
}

const text = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value : fallback)

export function candidateLabel(candidate: ResearchCandidateLike) {
  return text(candidate.title, "Untitled option")
}

function candidateFacts(candidate: ResearchCandidateLike) {
  return [
    `ID: ${text(candidate.id, 'n/a')}`,
    `Title: ${candidateLabel(candidate)}`,
    `Category: ${text(candidate.category, "research")}`,
    `URL: ${text(candidate.url, "n/a")}`,
    `Summary: ${text(candidate.summary, "n/a")}`,
    [
      candidate.provider ? `provider ${candidate.provider}` : undefined,
      candidate.price !== undefined ? `price ${candidate.price}${candidate.currency ? ` ${candidate.currency}` : ""}` : undefined,
      candidate.rating !== undefined ? `rating ${candidate.rating}` : undefined,
      candidate.location ? `location ${candidate.location}` : undefined,
    ]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join("\n")
}

/** Prefill text asking Chat to persist this candidate via research_shortlist save. */
export function shortlistPrompt(candidate: ResearchCandidateLike) {
  return [
    "Shortlist this option using the research tools (research_shortlist save):",
    candidateFacts(candidate),
    "Do not book, buy, apply, or submit anything without explicit approval.",
  ].join("\n")
}

/** Prefill text asking Chat to prepare an approval-gated external action. */
export function draftActionPrompt(candidate: ResearchCandidateLike) {
  return [
    "Prepare an external action for this option using the action tool (action prepare):",
    candidateFacts(candidate),
    "This must stay pending until I explicitly approve it. Never submit anything silently.",
  ].join("\n")
}

/** Prefill text asking Chat to drop a shortlist entry via research_shortlist remove. */
export function removeShortlistPrompt(id: string) {
  return `Remove the research shortlist entry with id "${id}" using the research tools (research_shortlist remove).`
}
