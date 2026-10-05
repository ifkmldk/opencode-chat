import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { locationTokens, runDeep } from "../src/research/orchestrate"

const places = () => Effect.succeed({ provider: "openstreetmap", places: [] })
const deepWith = (searchJobs: Parameters<typeof runDeep>[0]["searchJobs"], pages: Record<string, string> = {}) =>
  runDeep({
    searchPlaces: places,
    searchJobs,
    scrape: (url: string) => Effect.succeed({ text: pages[url] ?? "", source: "chromium" }),
  })

describe("research_deep job search", () => {
  test("a failed search is reported as an error, not as an empty success", async () => {
    const deep = deepWith(() => Effect.succeed({ results: [], error: "websearch rate limited" }))
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", location: "Tangerang" }))
    expect(out.candidates).toEqual([])
    expect(out.providers[0]).toMatchObject({ status: "error" })
    expect(out.limitations.join(" ")).toContain("do not list jobs from memory")
  })

  test("zero results is unavailable with an instruction not to invent", async () => {
    const out = await Effect.runPromise(deepWith(() => Effect.succeed({ results: [] }))({ query: "data analyst", category: "job", location: "Tangerang" }))
    expect(out.providers[0]).toMatchObject({ status: "unavailable" })
    expect(out.limitations.join(" ")).toContain("do not invent")
  })

  test("keeps real listings without geocoding, confirms location on the page, drops pages that show another place", async () => {
    const deep = deepWith(
      () =>
        Effect.succeed({
          results: [
            { url: "https://jobs.test/jakarta", title: "BI Analyst", content: "PT A" },
            { url: "https://jobs.test/tangerang", title: "Data Analyst", content: "PT B" },
            { url: "https://jobs.test/unknown", title: "Analyst Tangerang Selatan", content: "PT C" },
          ],
        }),
      {
        "https://jobs.test/jakarta": `${"Job description. ".repeat(40)}\n## Structured job postings (JSON-LD)\n- **BI Analyst** · PT A · Jakarta Selatan`,
        "https://jobs.test/tangerang": `${"Job description. ".repeat(40)} Lokasi: Tangerang, Banten. Apply now.`,
      },
    )
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", location: "Tangerang" }))
    expect(out.candidates.map((c) => c.url)).toEqual(["https://jobs.test/tangerang", "https://jobs.test/unknown"])
    expect(out.candidates[0]).toMatchObject({ verified: { location: "yes" } })
    expect(out.candidates.every((c) => c.url)).toBe(true)
  })

  test("location tokens skip generic words and expand local aliases", () => {
    expect(locationTokens("sekitar BSD")).toContain("serpong")
    expect(locationTokens("Kota Tangerang")).toContain("tangerang")
    expect(locationTokens(undefined)).toEqual([])
  })
})

describe("already-applied listings", () => {
  test("a saved note with the same link or the same title never comes back", async () => {
    const deep = runDeep({
      searchPlaces: places,
      searchJobs: () =>
        Effect.succeed({
          results: [
            { url: "https://www.jobstreet.co.id/id/job/111?ref=search", title: "Data Analyst - PT Alpha Tangerang", content: "Tangerang" },
            { url: "https://jobs.test/b", title: "Business Intelligence Analyst PT Beta Tangerang", content: "Tangerang" },
            { url: "https://jobs.test/c", title: "Reporting Analyst PT Gamma Tangerang", content: "Tangerang" },
          ],
        }),
      scrape: () => Effect.succeed({ text: "", source: "none" }),
      excluded: () =>
        Effect.succeed([
          "Sudah dilamar: PT Alpha https://jobstreet.co.id/id/job/111",
          "Sudah dilamar: business intelligence analyst pt beta tangerang",
        ]),
    })
    const out = await Effect.runPromise(deep({ query: "data analyst", category: "job", location: "Tangerang" }))
    expect(out.candidates.map((c) => c.url)).toEqual(["https://jobs.test/c"])
  })
})
