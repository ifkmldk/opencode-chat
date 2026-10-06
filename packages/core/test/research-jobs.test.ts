import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Geo } from "../src/maps/geo"
import type { MapsCompany } from "../src/maps/company"
import { Stations } from "../src/maps/stations"
import { runDeep, type Deps } from "../src/research/orchestrate"
import type { JobBoards } from "../src/scrape/jobboards"
import type { MapsTransit } from "../src/maps/transit-buffer"

const OWNER =
  "Carikan perusahaan yang buka loker data analyst atau sejenisnya posisi yg relevan dengan gaji di atas 11 juta. lokasi perusahaannya wajib radius <1km dari KRL, boleh dari line rangkas bitung atau yg line lain. yg jelas dari stasiun KRL tsb bisa jalan kaki hemat ongkos."
const sudirman = Stations.find("Stasiun Sudirman")!
const near = Geo.destination(sudirman, 0, 300)
// In the sea off Ancol: kilometres from any station.
const far = { latitude: -6.05, longitude: 106.85 }

const listing = (index: number, extra: Partial<JobBoards.Listing> = {}): JobBoards.Listing => ({
  id: `kalibrr-${index}`,
  title: "Data Analyst",
  company: `PT Alpha ${index}`,
  location: "South Jakarta, DKI Jakarta",
  url: `https://jobs.test/${index}`,
  board: "kalibrr",
  ...extra,
})

/** Real orchestration with fake network edges: boards, office lookup, station buffer and walking routes. */
function fakes(input: {
  listings: readonly JobBoards.Listing[]
  offices?: Record<string, Geo.Point>
  web?: { url: string; title?: string; content?: string }[]
  seen?: { phrases?: readonly string[]; cities?: readonly string[]; located?: MapsCompany.Request[] }
}): Deps {
  return {
    searchPlaces: () => Effect.succeed({ provider: "openstreetmap", places: [] }),
    searchJobs: (request) => Effect.succeed({ results: request.exact ? [] : (input.web ?? []) }),
    scrape: () => Effect.succeed({ text: "", source: "none" }),
    board: (request) => {
      if (input.seen) {
        input.seen.phrases = request.phrases
        input.seen.cities = request.cities
      }
      // Kalibrr answers the quick (JSON) call; the browser call has nothing more here.
      const listings = request.kind === "browser" ? [] : input.listings
      return Effect.succeed({
        listings,
        reports: request.kind === "browser" ? [] : [{ board: "kalibrr", count: listings.length, searches: request.phrases.length * request.cities.length }],
        manual: [],
      })
    },
    locateCompany: (request) => {
      input.seen?.located?.push(request)
      const point = input.offices?.[request.name]
      return Effect.succeed(
        point
          ? { located: { name: `${request.name} Tower`, ...point, address: "Jl. Jend. Sudirman", source: "osm-office" as const, confidence: "high" as const } }
          : { reason: `no OSM office, building or brand named like "${request.name}" in Jabodetabek` },
      )
    },
    nearTransit: (request) => Effect.succeed({ stations: Stations.list({ lines: request.lines }), features: [], total: 0 }),
    walking: (pairs) =>
      Effect.succeed(pairs.map((pair) => ({ meters: Math.round(Geo.inverse(pair.from, pair.to).meters * 1.25), seconds: 300 }))),
  }
}

describe("research_deep jobs near KRL stations", () => {
  test("the office is located for every company and its station distance measured; unknown and far offices get their own tables", async () => {
    const seen = { located: [] as MapsCompany.Request[] }
    const deep = runDeep(
      fakes({
        listings: [
          listing(1, { company: "PT Near", address: "Jl. Jend. Sudirman Kav. 1, Jakarta" }),
          listing(2, { company: "PT Far" }),
          listing(3, { company: "PT Unknown" }),
          listing(4, { company: undefined, title: "BI Analyst" }),
        ],
        offices: { "PT Near": near, "PT Far": far },
        seen,
      }),
    )
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toContain("PT Near")
    expect(out.table).toContain("Sudirman")
    expect(out.table).not.toContain("PT Far")
    expect(out.outsideTable).toContain("PT Far")
    expect(out.unlocatedTable).toContain("PT Unknown")
    expect(out.unlocatedTable).toContain("nama perusahaan tidak ada di OSM")
    expect(out.unlocatedTable).toContain("nama perusahaan tidak tercantum")
    const hit = out.candidates.find((candidate) => candidate.company === "PT Near")!
    expect(hit.station).toBe("Sudirman")
    expect(hit.distanceM).toBeGreaterThan(250)
    expect(hit.distanceM).toBeLessThan(350)
    expect(hit.walkingM).toBeGreaterThan(hit.distanceM!)
    expect(hit.latitude).toBeCloseTo(near.latitude, 6)
    expect(hit.verified?.location).toBe("yes")
    // A distance is never invented from text: no row has 0 m.
    expect(out.candidates.some((candidate) => candidate.distanceM === 0)).toBe(false)
    expect(seen.located.find((request) => request.name === "PT Near")?.address).toBe("Jl. Jend. Sudirman Kav. 1, Jakarta")
    expect(out.summary).toContain("2 belum ketemu")
  })

  test("an undisclosed salary stays, a disclosed salary below the floor is dropped", async () => {
    const deep = runDeep(
      fakes({
        listings: [
          listing(1, { company: "PT None" }),
          listing(2, { company: "PT Low", salary: "Rp 5.500.000 – 7.500.000" }),
          listing(3, { company: "PT High", salary: "Rp 12 juta - Rp 15 juta/bulan" }),
        ],
        offices: { "PT None": near, "PT Low": near, "PT High": near },
      }),
    )
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toContain("PT None")
    expect(out.table).toContain("tidak dicantumkan")
    expect(out.table).toContain("PT High")
    expect(out.table).not.toContain("PT Low")
    expect(out.summary).toContain("1 gaji tercantum di bawah 11 jt")
  })

  test("maxResults 150 returns 150 rows, not 50", async () => {
    const listings = Array.from({ length: 160 }, (_, index) => listing(index))
    const offices = Object.fromEntries(listings.map((row, index) => [row.company!, Geo.destination(sudirman, index * 2, 200 + index)]))
    const out = await Effect.runPromise(runDeep(fakes({ listings, offices }))({ query: OWNER, category: "job", maxResults: 150 }))
    expect(out.table?.split("\n").filter((line) => /^\| \d+ \|/.test(line))).toHaveLength(150)
    expect(out.candidates.length).toBeGreaterThanOrEqual(150)
  })

  test("boards get clean role phrases and every city the KRL lines pass through", async () => {
    const seen: { phrases?: readonly string[]; cities?: readonly string[] } = {}
    await Effect.runPromise(runDeep(fakes({ listings: [], seen }))({ query: OWNER, category: "job" }))
    expect(seen.phrases).toEqual(["data analyst", "business intelligence", "bi analyst", "reporting analyst"])
    expect(seen.phrases!.join(" ")).not.toMatch(/gaji|juta|krl|stasiun|radius|km|lokasi/)
    expect(seen.cities).toEqual(["jakarta", "tangerang selatan", "tangerang", "bekasi", "depok", "bogor", "cikarang", "rangkasbitung"])
  })

  test("listings for other roles and other cities are counted, not shown", async () => {
    const deep = runDeep(
      fakes({
        listings: [
          listing(1, { company: "PT A" }),
          listing(2, { company: "PT B", title: "Cyber Security Analyst" }),
          listing(3, { company: "PT C", location: "Bandung, Jawa Barat" }),
          listing(4, { company: "PT D", title: "Data Engineer" }),
        ],
        offices: { "PT A": near, "PT B": near, "PT C": near, "PT D": near },
      }),
    )
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toContain("PT A")
    expect(out.table).toContain("Mirip")
    expect(out.table).not.toContain("PT B")
    expect(out.table).not.toContain("PT C")
    expect(out.summary).toContain("1 posisi lain, 1 kota lain")
  })

  test("web posts go through the same pipeline: a company named in the post is located", async () => {
    const deep = runDeep(
      fakes({
        listings: [],
        offices: { "PT Kredit Pintar": near },
        web: [{ url: "https://www.example-jobs.test/post/9", title: "Lowongan Data Analyst - PT Kredit Pintar - Jakarta", content: "Gaji Rp 12 - 14 juta per bulan" }],
      }),
    )
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toContain("PT Kredit Pintar")
    expect(out.table).toContain("12 - 14 juta")
  })
})

describe("research_deep jobs without stations", () => {
  test("a failed web search is reported as an error, not as an empty success", async () => {
    const deep = runDeep({
      ...fakes({ listings: [] }),
      searchJobs: () => Effect.succeed({ results: [], error: "websearch rate limited" }),
    })
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", location: "Tangerang" }))
    expect(out.candidates).toEqual([])
    expect(out.providers.find((provider) => provider.provider === "web")).toMatchObject({ status: "error" })
    expect(out.limitations.join(" ")).toContain("do not invent")
  })

  test("offices are still located and the nearest station is shown", async () => {
    const out = await Effect.runPromise(
      runDeep(fakes({ listings: [listing(1, { company: "PT Far", location: "Jakarta Selatan" })], offices: { "PT Far": far } }))({
        query: "loker data analyst",
        category: "job",
        location: "Jakarta",
      }),
    )
    expect(out.table).toContain("PT Far")
    expect(out.candidates[0]?.station).toBeDefined()
    expect(out.outsideTable).toBeUndefined()
  })
})

describe("already-applied listings", () => {
  test("a saved note with the same link or the same title never comes back", async () => {
    const deep = runDeep({
      ...fakes({
        listings: [
          listing(1, { title: "Data Analyst - PT Alpha Tangerang", company: "PT Alpha", url: "https://www.jobstreet.co.id/id/job/111?ref=search", location: "Tangerang" }),
          listing(2, { title: "Business Intelligence Analyst PT Beta Tangerang", company: "PT Beta", location: "Tangerang" }),
          listing(3, { title: "Reporting Analyst PT Gamma Tangerang", company: "PT Gamma", location: "Tangerang" }),
        ],
        offices: { "PT Alpha": near, "PT Beta": near, "PT Gamma": near },
      }),
      excluded: () =>
        Effect.succeed(["Sudah dilamar: PT Alpha https://jobstreet.co.id/id/job/111", "Sudah dilamar: business intelligence analyst pt beta tangerang"]),
    })
    const out = await Effect.runPromise(deep({ query: "data analyst atau sejenisnya", category: "job", location: "Tangerang" }))
    expect(out.candidates.map((candidate) => candidate.company)).toEqual(["PT Gamma"])
  })
})

describe("jobs_match words", () => {
  test("trailing punctuation and Indonesian filler are not skills", async () => {
    const { JobsTool } = await import("../src/tool/plugin/jobs")
    const words = JobsTool.__test.words("Menguasai SQL, Excel. dan Node.js; pengalaman dengan Power-BI")
    expect([...words]).toEqual(["menguasai", "sql", "excel", "node.js", "pengalaman", "power-bi"])
  })
})

describe("office address from the web", () => {
  test("a company not in OSM is placed from an address in search snippets, marked approximate", async () => {
    const asked: string[] = []
    const base = fakes({ listings: [listing(1, { company: "PT Sinar Data Kreasi" })] })
    const deep = runDeep({
      ...base,
      searchJobs: (request) =>
        Effect.succeed({
          results:
            request.exact && request.query.includes("alamat kantor")
              ? [{ url: "https://example.test/profil", title: "PT Sinar Data Kreasi - Profil", content: "Alamat: Jl. Jend. Sudirman Kav. 52-53, Senayan, Jakarta Selatan 12190. Telp 021" }]
              : [],
        }),
      searchPlaces: (request) => {
        asked.push(request.query)
        return Effect.succeed({ provider: "openstreetmap", places: [{ id: "osm:way/1", name: "Jalan Jenderal Sudirman", latitude: near.latitude, longitude: near.longitude, source: "openstreetmap" as const }] })
      },
    })
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(asked).toEqual(["Jl. Jend. Sudirman Kav. 52-53, Senayan, Jakarta Selatan 12190"])
    expect(out.table).toContain("PT Sinar Data Kreasi")
    expect(out.table).toContain("[perkiraan]")
  })
})

describe("what is not an office or not a job", () => {
  test("a partial name match on the map (a print shop for tiket.com) is not the office", async () => {
    const deep = runDeep({
      ...fakes({ listings: [listing(1, { company: "tiket.com" })] }),
      locateCompany: () =>
        Effect.succeed({ located: { name: "Cetak Tiket", ...near, source: "osm-name" as const, confidence: "low" as const, note: 'OSM name "Cetak Tiket" only partly matches "tiket.com"' } }),
    })
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toBeUndefined()
    expect(out.unlocatedTable).toContain('di peta hanya ada "Cetak Tiket"')
  })

  test("a board's search page found by web search is not listed as a job", async () => {
    const deep = runDeep(
      fakes({
        listings: [],
        offices: { "PT ASTRA OTOPARTS Tbk": near },
        web: [{ url: "https://id.linkedin.com/jobs/data-analyst-jakarta-jobs", title: "1.000+ Pekerjaan Data Analyst Jakarta di Indonesia", content: "Data Analyst PT ASTRA OTOPARTS Tbk" }],
      }),
    )
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" }))
    expect(out.table).toBeUndefined()
    expect(out.summary).toContain("1 halaman pencarian papan dilewati")
  })
})

describe("time budget", () => {
  test("offices not looked up in time are listed with that reason, never dropped", async () => {
    process.env.OPENCODE_RESEARCH_BUDGET_MS = "0"
    const out = await Effect.runPromise(runDeep(fakes({ listings: [listing(1, { company: "PT Late" })], offices: { "PT Late": near } }))({ query: OWNER, category: "job" })).finally(() => {
      delete process.env.OPENCODE_RESEARCH_BUDGET_MS
    })
    expect(out.summary?.split("\n")[0]).toStartWith("BELUM SELESAI")
    expect(out.unlocatedTable).toContain("PT Late")
    expect(out.unlocatedTable).toContain("belum dicari")
    expect(out.limitations.join(" ")).toContain("call research_deep again")
  })
})

describe("walking radius", () => {
  test("the main table holds walks up to the asked radius, not beyond", async () => {
    // The fake walk is 1.25x the straight line: 700 m → 875 m walk (inside), 850 m → 1063 m walk (outside).
    const out = await Effect.runPromise(
      runDeep(
        fakes({
          listings: [listing(1, { company: "PT Inside" }), listing(2, { company: "PT Beyond" })],
          offices: { "PT Inside": Geo.destination(sudirman, 90, 700), "PT Beyond": Geo.destination(sudirman, 90, 850) },
        }),
      )({ query: OWNER, category: "job" }),
    )
    expect(out.table).toContain("PT Inside")
    expect(out.table).not.toContain("PT Beyond")
    expect(out.outsideTable).toContain("PT Beyond")
  })
})

describe("employers near the stations", () => {
  const office = (id: string, name: string, website?: string): MapsTransit.Feature => ({
    id,
    name,
    category: "office=company",
    ...Geo.destination(sudirman, 0, 200),
    ...(website ? { website } : {}),
    tags: { office: "company", name },
    nearest: { stationId: sudirman.id, station: sudirman.name, lines: sudirman.lines, meters: 200 },
  })

  test("a website missing in OSM comes from the boards or a web search on the name; only the company's own domain is accepted", async () => {
    process.env.OPENCODE_MAPS_CACHE_DIR = "off"
    const checked: { company: string; website?: string }[] = []
    const queries: string[] = []
    const base = fakes({ listings: [listing(1, { company: "PT Board Known", website: "https://boardknown.co.id/" })] })
    const deep = runDeep({
      ...base,
      nearTransit: (request) =>
        Effect.succeed({
          stations: Stations.list({ lines: request.lines }),
          features: [
            office("osm:node/1", "PT Osm Site", "https://osmsite.com/"),
            office("osm:node/2", "PT Board Known"),
            office("osm:node/3", "PT Zebracorp Nusantara"),
            office("osm:node/4", "PT Nowhere Found"),
          ],
          total: 4,
        }),
      searchJobs: (request) => {
        queries.push(request.query)
        if (request.query.includes("Zebracorp"))
          return Effect.succeed({
            results: [
              { url: "https://www.linkedin.com/company/zebracorp" },
              { url: "https://www.jobstreet.co.id/companies/zebracorp" },
              { url: "https://zebracorp.co.id/about" },
            ],
          })
        if (request.query.includes("Nowhere")) return Effect.succeed({ results: [{ url: "https://lokerjakarta.id/pt-nowhere-found" }] })
        return Effect.succeed({ results: [] })
      },
      careers: (request) => {
        checked.push({ company: request.company, ...(request.website ? { website: request.website } : {}) })
        return Effect.succeed({ company: request.company, ...(request.website ? { url: request.website } : {}), note: "Dibuka", match: "no" as const })
      },
    })
    const out = await Effect.runPromise(deep({ query: OWNER, category: "job" })).finally(() => {
      delete process.env.OPENCODE_MAPS_CACHE_DIR
    })
    const site = (company: string) => checked.find((check) => check.company === company)?.website
    expect(site("PT Osm Site")).toBe("https://osmsite.com/")
    expect(site("PT Board Known")).toBe("https://boardknown.co.id/")
    expect(site("PT Zebracorp Nusantara")).toBe("https://zebracorp.co.id/")
    expect(site("PT Nowhere Found")).toBeUndefined()
    expect(checked).toHaveLength(4)
    // Websites already known are not searched for.
    expect(queries.filter((query) => /official website|karir/.test(query)).some((query) => query.includes("Osm Site") || query.includes("Board Known"))).toBe(false)
    expect(out.companyTable).toContain("zebracorp.co.id")
    expect(out.companyTable).toContain("(dari pencarian web)")
    expect(out.companyTable).toContain("(dari papan lowongan)")
    expect(out.summary).toContain("halaman karir dicek: 4")
  })
})
