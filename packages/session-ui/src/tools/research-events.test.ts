import { describe, expect, test } from "bun:test"
import {
  RESEARCH_ASK_CHAT_EVENT,
  RESEARCH_CATEGORY_HINTS,
  RESEARCH_PROMPT_TEMPLATES,
  addResearchHistory,
  candidateLabel,
  clearResearchHistory,
  draftActionPrompt,
  formatRouteMeta,
  loadResearchHistory,
  mapEmbedUrl,
  placeOpenUrl,
  readResearchAskChatDetail,
  removeShortlistPrompt,
  requestResearchAskChat,
  researchSearchPrompt,
  routeDirectionsUrl,
  routeEmbedUrl,
  saveResearchHistory,
  shortlistPrompt,
  validateResearchFilters,
} from "./research-events"

describe("research-events", () => {
  test("builds read-only OSM embeds without an API key", () => {
    expect(mapEmbedUrl(-6.2, 106.8)).toBe(
      "https://www.openstreetmap.org/export/embed.html?bbox=106.75,-6.25,106.85,-6.15&layer=mapnik&marker=-6.2,106.8",
    )
    expect(routeEmbedUrl({ latitude: -6.2, longitude: 106.8 }, { latitude: -6.1, longitude: 106.9 })).toContain(
      "https://www.openstreetmap.org/export/embed.html?bbox=",
    )
    expect(formatRouteMeta(12500, 1800)).toBe("12.5 km · 30 min")
    expect(formatRouteMeta("far", "soon")).toBe("")
  })

  test("round-trips ask-chat events and rejects invalid payloads", () => {
    const target = new EventTarget()
    let received: Event | undefined
    target.addEventListener(RESEARCH_ASK_CHAT_EVENT, (event) => {
      received = event
    })
    const previous = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).window = { dispatchEvent: (event: Event) => target.dispatchEvent(event) }
    try {
      requestResearchAskChat("Shortlist this option")
      expect(readResearchAskChatDetail(received!)).toEqual({ text: "Shortlist this option" })
      expect(readResearchAskChatDetail(new Event(RESEARCH_ASK_CHAT_EVENT))).toBeUndefined()
      expect(
        readResearchAskChatDetail(new CustomEvent(RESEARCH_ASK_CHAT_EVENT, { detail: { text: "  " } })),
      ).toBeUndefined()
    } finally {
      if (previous === undefined) delete (globalThis as Record<string, unknown>).window
      else (globalThis as Record<string, unknown>).window = previous
    }
  })

  test("builds safe chat prefill prompts that never execute anything", () => {
    const candidate = { id: "opt-1", category: "hotel", title: "Grand Bali", url: "https://example.com/bali", summary: "Beachfront", price: 120, currency: "USD", rating: 4.8, location: "Bali" }
    expect(candidateLabel(candidate)).toBe("Grand Bali")
    expect(shortlistPrompt(candidate)).toContain("research_shortlist save")
    expect(shortlistPrompt(candidate)).toContain("Do not book, buy, apply")
    expect(draftActionPrompt(candidate)).toContain("action prepare")
    expect(draftActionPrompt(candidate)).toContain("pending until I explicitly approve")
    expect(removeShortlistPrompt("opt-1")).toContain("research_shortlist remove")
  })

  test("builds a filtered research_search prompt with budget and location", () => {
    const prompt = researchSearchPrompt({ query: "Bali hotel", category: "hotel", location: "Bali", budget: "max 150 USD/night" })
    expect(prompt).toContain("research_search")
    expect(prompt).toContain("Location: Bali.")
    expect(prompt).toContain("Budget: max 150 USD/night.")
    expect(prompt).toContain("without explicit approval")
    expect(researchSearchPrompt({ query: "Go", category: "course" })).not.toContain("Location:")
  })

  test("validates workspace filters without blocking and links out to OSM", () => {
    expect(RESEARCH_CATEGORY_HINTS.hotel).toContain("location")
    expect(RESEARCH_CATEGORY_HINTS.flight).toContain("origin")
    expect(validateResearchFilters({ query: "x", category: "hotel", location: "", budget: "" })).toContain("location")
    expect(validateResearchFilters({ query: "x", category: "hotel", location: "Bali", budget: "cheap" })).toContain("number")
    expect(validateResearchFilters({ query: "x", category: "hotel", location: "Bali", budget: "max 150 USD" })).toBeUndefined()
    expect(validateResearchFilters({ query: "x", category: "course" })).toBeUndefined()
    expect(placeOpenUrl(-6.2, 106.8, "https://example.com/p")).toBe("https://example.com/p")
    expect(placeOpenUrl(-6.2, 106.8, "javascript:alert(1)")).toContain("openstreetmap.org")
    expect(routeDirectionsUrl({ latitude: -6.2, longitude: 106.8 }, { latitude: -6.1, longitude: 106.9 })).toContain("openstreetmap.org/directions")
  })

  test("ships prompt templates and persists workspace history", () => {
    expect(RESEARCH_PROMPT_TEMPLATES.length).toBeGreaterThan(0)
    for (const template of RESEARCH_PROMPT_TEMPLATES) {
      expect(template.body).toContain("research_search")
      expect(template.body).toContain("without explicit approval")
    }
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
    expect(loadResearchHistory(storage)).toEqual([])
    const entries = addResearchHistory([], { query: "Bali hotel", category: "hotel", location: "Bali", budget: "max 150" })
    expect(entries).toHaveLength(1)
    saveResearchHistory(entries, storage)
    expect(loadResearchHistory(storage)).toHaveLength(1)
    expect(loadResearchHistory(storage)[0]?.query).toBe("Bali hotel")
    expect(addResearchHistory(entries, { query: "  ", category: "hotel", location: "", budget: "" })).toBe(entries)
    clearResearchHistory(storage)
    expect(loadResearchHistory(storage)).toEqual([])
  })
})
