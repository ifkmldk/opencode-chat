import { describe, expect, test } from "bun:test"
import {
  RESEARCH_ASK_CHAT_EVENT,
  candidateLabel,
  draftActionPrompt,
  formatRouteMeta,
  mapEmbedUrl,
  readResearchAskChatDetail,
  removeShortlistPrompt,
  requestResearchAskChat,
  researchSearchPrompt,
  routeEmbedUrl,
  shortlistPrompt,
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
})
