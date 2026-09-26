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

/** Per-category hint shown in the Research workspace panel. Non-blocking guidance. */
export const RESEARCH_CATEGORY_HINTS: Record<string, string> = {
  job: "Tip: add a location (e.g. Jakarta) and a salary range as budget.",
  hotel: "Tip: location is strongly recommended (city/area); budget e.g. max 150 USD/night.",
  flight: "Tip: use location for origin → destination (e.g. CGK → DPS); budget e.g. max 300 USD.",
  product: "Tip: budget helps compare price vs quality.",
  youtube: "Tip: location/budget are optional for video search.",
  place: "Tip: location is strongly recommended for places.",
  event: "Tip: location is strongly recommended for events.",
  course: "Tip: budget e.g. max 50 USD helps filter courses.",
  service: "Tip: location helps find nearby services.",
}

/** Categories where a location is strongly recommended (not a hard block). */
const LOCATION_RECOMMENDED = new Set(["hotel", "flight", "place", "event", "job", "service"])

/**
 * Non-blocking validation for workspace filters.
 * Returns a hint string when something looks off, undefined when fine.
 * Never blocks submit: the panel only displays the hint.
 */
export function validateResearchFilters(input: ResearchSearchInput): string | undefined {
  if (LOCATION_RECOMMENDED.has(input.category) && !input.location?.trim()) {
    return "Add a location for better results (optional but recommended)."
  }
  if (input.budget?.trim() && !/\d/.test(input.budget)) {
    return "Budget should include a number, e.g. max 150 USD/night."
  }
  return undefined
}

/** External OSM link for a place. Prefers the provider URL, falls back to lat/lon. */
export function placeOpenUrl(latitude: number, longitude: number, url?: unknown) {
  if (typeof url === "string" && /^https?:\/\//.test(url.trim())) return url.trim()
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`
}

/** External OSM directions link for a route. */
export function routeDirectionsUrl(origin: MapPoint, destination: MapPoint) {
  return `https://www.openstreetmap.org/directions?from=${origin.latitude}%2C${origin.longitude}&to=${destination.latitude}%2C${destination.longitude}`
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

/** Curated prompt templates for the workspace prompt library. Bodies reuse researchSearchPrompt so wording never drifts. */
export type ResearchPromptTemplate = { id: string; title: string; body: string }

export const RESEARCH_PROMPT_TEMPLATES: ResearchPromptTemplate[] = [
  {
    id: "hotel-value",
    title: "Hotel value pick",
    body: researchSearchPrompt({ query: "best value hotel", category: "hotel", location: "Bali", budget: "max 150 USD/night" }),
  },
  {
    id: "flight-cheap",
    title: "Cheap flight",
    body: researchSearchPrompt({ query: "cheapest direct flight", category: "flight", location: "CGK → DPS", budget: "max 300 USD" }),
  },
  {
    id: "job-match",
    title: "Job match",
    body: researchSearchPrompt({ query: "frontend engineer roles", category: "job", location: "Jakarta", budget: "min 15M IDR/month" }),
  },
  {
    id: "product-compare",
    title: "Product compare",
    body: researchSearchPrompt({ query: "wireless headphones", category: "product", budget: "max 200 USD" }),
  },
]

/** A past workspace query, persisted in localStorage so history survives reloads. */
export type ResearchHistoryEntry = { query: string; category: string; location: string; budget: string; at: number }

export const RESEARCH_HISTORY_KEY = "opencode.research.history"
export const RESEARCH_HISTORY_MAX = 20

type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function historyStorage(custom?: HistoryStorage): HistoryStorage | undefined {
  if (custom) return custom
  try {
    if (typeof localStorage !== "undefined") return localStorage
  } catch {
    return undefined
  }
  return undefined
}

export function loadResearchHistory(storage?: HistoryStorage): ResearchHistoryEntry[] {
  const store = historyStorage(storage)
  if (!store) return []
  try {
    const raw = store.getItem(RESEARCH_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is ResearchHistoryEntry =>
          !!item && typeof item === "object" && typeof (item as { query?: unknown }).query === "string",
      )
      .slice(0, RESEARCH_HISTORY_MAX)
  } catch {
    return []
  }
}

export function addResearchHistory(
  entries: ResearchHistoryEntry[],
  entry: Omit<ResearchHistoryEntry, "at">,
): ResearchHistoryEntry[] {
  const query = entry.query.trim()
  if (!query) return entries
  const next = [
    { ...entry, query, at: Date.now() },
    ...entries.filter((item) => item.query !== query || item.category !== entry.category),
  ]
  return next.slice(0, RESEARCH_HISTORY_MAX)
}

export function saveResearchHistory(entries: ResearchHistoryEntry[], storage?: HistoryStorage) {
  const store = historyStorage(storage)
  if (!store) return
  try {
    store.setItem(RESEARCH_HISTORY_KEY, JSON.stringify(entries.slice(0, RESEARCH_HISTORY_MAX)))
  } catch {
    // Storage full or unavailable: history is best-effort.
  }
}

export function clearResearchHistory(storage?: HistoryStorage) {
  const store = historyStorage(storage)
  if (!store) return
  try {
    store.removeItem(RESEARCH_HISTORY_KEY)
  } catch {
    // Already gone.
  }
}

