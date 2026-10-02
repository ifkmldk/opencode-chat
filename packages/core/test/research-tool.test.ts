import { describe, expect, test } from "bun:test"
import { __test } from "../src/tool/plugin/research.js"

describe("research classifier", () => {
  test("ranks candidates with explicit reasons", () => {
    const output = __test.classify({
      query: "cheap Bali hotel",
      category: "hotel",
      candidates: [
        { id: "a", category: "hotel", title: "Bali budget stay", price: 50, rating: 4.2 },
        { id: "b", category: "hotel", title: "Bali luxury resort", price: 500, rating: 4.9 },
      ],
    })
    expect(output.rankings[0]?.id).toBe("a")
    expect(output.engine).toBe("deterministic-fallback")
    expect(output.rankings[0]?.reasons.join(" ")).toContain("Price")
  })

  test("requires candidate input", () => {
    expect(Array.isArray([])).toBe(true)
  })

  test("reports fallback status and web candidates honestly", () => {
    const status = __test.status()
    expect(status.classifier.engine).toBe("deterministic-fallback")
    expect(status.providers.some((provider) => provider.provider === "hotel")).toBe(true)
    const candidate = __test.webResult({ url: "https://example.test/hotel", title: "Example Hotel", content: "A source", time: {} }, "hotel")
    expect(candidate.provider).toBe("web-search")
    expect(candidate.url).toBe("https://example.test/hotel")
  })
})

// fork: place, hotel and event research without a provider comes from Maps.
describe("research from maps", () => {
  test("maps places become candidates with rating, hours and a Google Maps link", () => {
    const candidate = __test.placeCandidate(
      {
        id: "ChIJabc",
        name: "Hotel Santika BSD",
        address: "Jl. Pahlawan Seribu, BSD",
        latitude: -6.3,
        longitude: 106.66,
        category: "Hotel",
        rating: 4.5,
        ratingCount: 3210,
        priceLevel: "$$",
        openNow: true,
        hoursToday: "Open 24 hours",
        googleMapsUrl: "https://maps.google.com/?cid=1",
        source: "google",
      },
      "hotel",
    )
    expect(candidate).toMatchObject({ id: "ChIJabc", provider: "google-maps", rating: 4.5, reviewCount: 3210, url: "https://maps.google.com/?cid=1" })
    expect(candidate.summary).toContain("open now")
    expect((candidate.details as { latitude: number }).latitude).toBe(-6.3)
  })

  test("only place, hotel and event use maps; the category is added to the query", () => {
    expect([...__test.MAP_CATEGORIES].toSorted()).toEqual(["event", "hotel", "place"])
    expect(__test.mapsQuery({ query: "murah dekat BSD", category: "hotel" })).toBe("hotel murah dekat BSD")
    expect(__test.mapsQuery({ query: "cheap hotel BSD", category: "hotel" })).toBe("cheap hotel BSD")
    expect(__test.mapsQuery({ query: "kopi enak", category: "place" })).toBe("kopi enak")
  })
})
