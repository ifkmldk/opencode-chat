import { describe, expect, test } from "bun:test"
import { extractConstraints } from "../src/research/constraints.js"
import { nearestStation, RANGKASBITUNG_STATIONS } from "../src/research/transit.js"
import { runDeep } from "../src/research/orchestrate.js"
import { ResearchTool } from "../src/tool/plugin/research.js"
import { Effect } from "effect"

describe("research constraints", () => {
  test("carport becomes a hard must + anchor", () => {
    const c = extractConstraints("kontrakan daerah sudirman ada carport", "Jl. Sudirman, Bandung")
    expect(c.must).toContain("carport")
    expect(c.anchor).toBe("Jl. Sudirman, Bandung")
  })
  test("KRL rangkasbitung becomes a 1km walking corridor", () => {
    const c = extractConstraints("cari kerja data analyst sekitar KRL rangkasbitung bisa jalan dari stasiun", "")
    expect(c.transitLine).toBe("KRL Rangkasbitung")
    expect(c.radiusKm).toBe(1)
    expect(c.travelMode).toBe("walking")
  })
})

describe("transit corridor", () => {
  test("nearest station resolves along the line", () => {
    const near = nearestStation({ latitude: -6.3211, longitude: 106.6697 })
    expect(near.station.name).toBe("Stasiun Serpong")
    expect(near.meters).toBeLessThan(50)
    expect(RANGKASBITUNG_STATIONS.length).toBeGreaterThan(15)
  })
})

describe("research honesty", () => {
  test("web candidates carry source + checkedAt + priceNote", () => {
    const out = ResearchTool.__test.webResult({ url: "https://x.test/a", title: "A", content: "hello" } as never, "hotel")
    expect(out.source).toBe("web-search")
    expect(out.checkedAt).toBeGreaterThan(0)
    expect(out.priceNote).toContain("no live price")
  })
  test("limitations are honest per category", () => {
    expect(ResearchTool.__test.honestyLimitations("hotel", "openstreetmap").join(" ")).toContain("no live date-specific price")
    expect(ResearchTool.__test.honestyLimitations("job", "web-search").join(" ")).toContain("No structured jobs provider")
  })
})

describe("research_deep live probes (network, no quota)", () => {
  const live = process.env.OPENCODE_LIVE_PROBE === "1" ? test : test.skip
  live("sudirman anchor resolves + rental search returns nearby candidates", async () => {
    const { MapsOsm } = await import("../src/maps/osm.js")
    const center = await MapsOsm.geocode("Jl. Sudirman, Bandung")
    expect(center?.latitude).toBeGreaterThan(-7.5)
    const rows = await MapsOsm.search("kontrakan", {
      limit: 5,
      near: { latitude: center!.latitude, longitude: center!.longitude },
    })
    expect(rows.length).toBeGreaterThan(0)
  }, 60_000)
  live("BSD hotel search returns candidates", async () => {
    const { MapsOsm } = await import("../src/maps/osm.js")
    const center = await MapsOsm.geocode("BSD, Tangerang Selatan")
    const rows = await MapsOsm.search("hotel", {
      limit: 5,
      near: { latitude: center!.latitude, longitude: center!.longitude },
    })
    expect(rows.length).toBeGreaterThan(0)
  }, 60_000)
})

describe("research_deep orchestration", () => {
  test("corridor drops far places, hard must drops unverified", async () => {
    const deep = runDeep({
      searchPlaces: () =>
        Effect.succeed({
          provider: "openstreetmap",
          places: [
            { id: "near", name: "Kost Dekat Serpong", address: "Serpong", latitude: -6.3211, longitude: 106.6697, url: "https://osm.org/near", source: "openstreetmap" as const },
            // fake-far: koordinat tengah laut (0,0) → >1000km dari semua stasiun → wajib dibuang
            { id: "far", name: "Kost Jauh Sekali", address: "Nowhere", latitude: 0, longitude: 0, url: "https://osm.org/far", source: "openstreetmap" as const },
          ],
        }),
      scrape: (url: string) => Effect.succeed({ text: url.includes("near") ? "fasilitas lengkap ada carport luas" : "kos biasa", source: "webfetch" }),
    })
    const out = await Effect.runPromise(deep({ query: "kontrakan carport", category: "place", transitLine: "KRL Rangkasbitung", must: ["carport"] }))
    expect(out.candidates.map((c) => c.id)).toEqual(["near"])
    expect((out.candidates[0] as unknown as { station?: string }).station).toBe("Stasiun Serpong")
    expect(out.candidates[0]!.verified).toMatchObject({ carport: "yes" })
    expect(out.limitations.join(" ")).toContain("Must-have keras: carport")
  })

  test("job category uses web fallback instead of empty map results", async () => {
    const deep = runDeep({
      searchPlaces: () => Effect.succeed({ provider: "openstreetmap", places: [] }),
      searchJobs: () =>
        Effect.succeed({
          results: [
            { url: "https://jobs.test/a", title: "Data Analyst — Serpong", content: "Lowongan data analyst dekat Stasiun Serpong" },
          ],
        }),
      scrape: () => Effect.succeed({ text: "", source: "none" }),
    })
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", transitLine: "KRL Rangkasbitung" }))
    expect(out.providers[0]!.provider).toBe("web-search")
    expect(out.candidates.map((c) => c.id)).toEqual(["https://jobs.test/a"])
    expect(out.limitations.join(" ")).toContain("No structured jobs provider")
  })
})
