import { describe, expect, test } from "bun:test"
import { extractConstraints } from "../src/research/constraints.js"
import { nearestStation, RANGKASBITUNG_STATIONS } from "../src/research/transit.js"
import { Stations } from "../src/maps/stations.js"
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
    const serpong = RANGKASBITUNG_STATIONS.find((station) => station.name === "Serpong")!
    const near = nearestStation(serpong, { lines: ["rangkasbitung"] })
    expect(near.station.name).toBe("Serpong")
    expect(near.meters).toBeLessThan(1)
    expect(RANGKASBITUNG_STATIONS.map((station) => station.name)).toContain("Jatake")
    expect(nearestStation(serpong, RANGKASBITUNG_STATIONS).station.name).toBe("Serpong")
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
  test("corridor drops far places; a must-have is read on the place's own website, never on the OSM page", async () => {
    const scraped: string[] = []
    const deep = runDeep({
      searchPlaces: () =>
        Effect.succeed({
          provider: "openstreetmap",
          places: [
            { id: "near", name: "Kost Dekat Serpong", address: "Serpong", latitude: -6.3211, longitude: 106.6697, url: "https://www.openstreetmap.org/node/1", website: "https://kost-near.test", source: "openstreetmap" as const },
            { id: "nocarport", name: "Kost Tanpa Carport", address: "Serpong", latitude: -6.3215, longitude: 106.6699, url: "https://www.openstreetmap.org/node/2", website: "https://kost-plain.test", source: "openstreetmap" as const },
            { id: "unknown", name: "Kost Tanpa Website", address: "Serpong", latitude: -6.3213, longitude: 106.6695, url: "https://www.openstreetmap.org/node/3", source: "openstreetmap" as const },
            // fake-far: koordinat tengah laut (0,0) → >1000km dari semua stasiun → wajib dibuang
            { id: "far", name: "Kost Jauh Sekali", address: "Nowhere", latitude: 0, longitude: 0, url: "https://www.openstreetmap.org/node/4", source: "openstreetmap" as const },
          ],
        }),
      scrape: (url: string) => {
        scraped.push(url)
        return Effect.succeed({ text: url.includes("near") ? "fasilitas lengkap ada carport luas" : "kos biasa, tidak ada carport", source: "webfetch" })
      },
    })
    const out = await Effect.runPromise(deep({ query: "kontrakan carport", category: "place", transitLine: "KRL Rangkasbitung", must: ["carport"] }))
    expect(out.candidates.map((c) => c.id)).toEqual(["near", "unknown"])
    expect(out.candidates[0]!.station).toBe("Serpong")
    expect(out.candidates[0]!.verified).toMatchObject({ carport: "yes" })
    expect(out.candidates[1]!.verified).toMatchObject({ carport: "unknown" })
    expect(scraped.some((url) => url.includes("openstreetmap.org"))).toBe(false)
    expect(out.limitations.join(" ")).toContain("Must-haves (carport)")
  })

  test("a station named in a job post is not a distance: the row stays unlocated instead of getting 0 m", async () => {
    const serpong = Stations.find("Stasiun Serpong")!
    const deep = runDeep({
      searchPlaces: () => Effect.succeed({ provider: "openstreetmap", places: [] }),
      searchJobs: (request) =>
        Effect.succeed({
          results: request.exact
            ? []
            : [
                { url: "https://jobs.test/a", title: "Data Analyst — Serpong", content: "Lowongan data analyst dekat Stasiun Serpong" },
                { url: "https://jobs.test/b", title: "Data Analyst - PT Dekat Serpong", content: "Lowongan data analyst" },
              ],
        }),
      scrape: () => Effect.succeed({ text: "", source: "none" }),
      locateCompany: (request) =>
        Effect.succeed(
          request.name === "PT Dekat Serpong"
            ? { located: { name: "PT Dekat Serpong", latitude: serpong.latitude + 0.003, longitude: serpong.longitude, source: "osm-office" as const, confidence: "high" as const } }
            : { reason: "not found" },
        ),
      walking: (pairs) => Effect.succeed(pairs.map(() => undefined)),
    })
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", transitLine: "KRL Rangkasbitung" }))
    expect(out.candidates.some((c) => c.distanceM === 0)).toBe(false)
    const located = out.candidates.find((c) => c.company === "PT Dekat Serpong")!
    expect(located.station).toBe("Serpong")
    expect(located.distanceM).toBeGreaterThan(300)
    expect(located.distanceM).toBeLessThan(400)
    expect(out.unlocatedTable).toContain("Data Analyst — Serpong")
    expect(out.unlocatedTable).toContain("postingan tanpa nama perusahaan")
    expect(out.limitations.join(" ")).toContain("Stations: KRL Rangkasbitung")
  })
})
