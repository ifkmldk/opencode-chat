export * as ResearchDeep from "./research-deep.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { KV } from "../../kv.js"
import { Permission } from "../../permission.js"
import { MapsSearch } from "../../maps/search.js"
import { runDeep } from "../../research/orchestrate.js"
import { UltimateScrape } from "../../scrape/engine.js"
import { WebSearch } from "../../websearch.js"
import { MemoryStore } from "../../memory/store.js"
import { extractTextFromHTML } from "./webfetch.js"
import { JobWeb } from "./job-web.js"
import { JobBoards } from "../../scrape/jobboards.js"
import { Boards } from "../../scrape/boards.js"

const Cats = ["job", "hotel", "flight", "product", "youtube", "place", "event", "course", "service", "other"] as const
const Category = Schema.Literals(Cats)
const DeepInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  category: Category,
  location: Schema.optional(Schema.String),
  budget: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1000000000 }))),
  maxResults: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  anchor: Schema.optional(Schema.String),
  radiusKm: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 100 }))),
  travelMode: Schema.optional(Schema.Literals(["driving", "walking", "transit"] as const)),
  must: Schema.optional(Schema.Array(Schema.String)),
  transitLine: Schema.optional(Schema.String),
})
const DeepCandidate = Schema.Struct({
  id: Schema.String,
  category: Category,
  title: Schema.String,
  provider: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  distanceM: Schema.optional(Schema.Number),
  anchor: Schema.optional(Schema.String),
  travelMode: Schema.optional(Schema.Literals(["driving", "walking", "transit"] as const)),
  travelMinutes: Schema.optional(Schema.Number),
  verified: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["yes", "no", "unknown"] as const))),
  checkedAt: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.Literals(["openstreetmap", "web-search", "scraped"] as const)),
  priceNote: Schema.optional(Schema.String),
  station: Schema.optional(Schema.String),
})
const DeepOutput = Schema.Struct({
  query: Schema.String,
  category: Category,
  providers: Schema.Array(Schema.Struct({ provider: Schema.String, status: Schema.String })),
  candidates: Schema.Array(DeepCandidate),
  table: Schema.optional(Schema.String),
  careerTable: Schema.optional(Schema.String),
  limitations: Schema.optional(Schema.Array(Schema.String)),
  checkedAt: Schema.optional(Schema.Number),
})

/** research_deep: satu orkestrasi search→anchor→radius→ukur→skor→scrape-verify→jawab. */
export const Plugin = {
  id: "opencode.tool.research-deep",
  effect: Effect.fn("ResearchDeep.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const kv = yield* KV.Service
    const http = yield* HttpClient.HttpClient
    const websearch = yield* WebSearch.Service
    const memory = yield* MemoryStore.Service
    const guard = (action: string, resources: string[], c: Tool.Context) =>
      permission
        .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: `Research permission denied: ${error.message}`, error })))
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "research_deep",
        options: { codemode: false, permission: "research.deep" },
        description:
          "Deep integrated research: extracts constraints (anchor, radius, must-have attributes, transit corridor), searches maps, filters by radius/corridor, verifies must-have attributes by scraping, and returns ranked candidates with distances, verification badges, sources and limitations. Use for kontrakan/loker/hotel queries with hard requirements.",
        input: DeepInput,
        output: DeepOutput,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard("research.deep", [input.query], c)
            // fork: built per-execution so searchJobs uses the calling session, not a stale id.
            const deep = runDeep({
              searchPlaces: ({ query, near, limit }: { query: string; near?: string; limit: number }) =>
                MapsSearch.make(ctx, kv)
                  .places({ query, ...(near ? { near } : {}), limit })
                  .pipe(Effect.map((found) => ({ provider: found.provider, places: found.places }))),
              // fork: notes the user saved as already applied / rejected (title starts with "Sudah dilamar", "Ditolak", "Applied" or "Rejected").
              excluded: () =>
                memory.list().pipe(
                  Effect.map((entries) => entries.filter((entry) => /^(sudah dilamar|ditolak|applied|rejected)/i.test(entry.title)).map((entry) => `${entry.title} ${entry.body}`)),
                  Effect.orElseSucceed(() => [] as string[]),
                ),
              scrape: (url: string) =>
                UltimateScrape.run(http, { url, mode: "stealth" }).pipe(
                  Effect.map((out) => ({ text: extractTextFromHTML(out.output), source: out.engine })),
                  Effect.orElseSucceed(() => ({ text: "", source: "none" })),
                ),
              board: (boardInput: { query: string; location?: string }) =>
                Effect.promise(() => {
                  const places = JobBoards.cities(boardInput.query, boardInput.location)
                  if (places.length === 0) return Promise.resolve({ listings: [], reports: [], manual: [] })
                  const role = JobBoards.role(boardInput.query, places)
                  return Boards.fetchAll({ role, cities: places }).then((found) => ({ ...found, manual: Boards.manualSearch({ role, cities: places }) }))
                }),
              careers: (careerInput: { company: string; role: string }) =>
                Effect.gen(function* () {
                  const hits = yield* websearch
                    .query({ query: `${careerInput.company} karir career lowongan resmi` }, { sessionID: c.sessionID })
                    .pipe(Effect.map((web) => web.results), Effect.orElseSucceed(() => [] as readonly { url: string }[]))
                  const checked = yield* Effect.promise(() => JobBoards.careerCheck(hits, careerInput))
                  // The page opened but plain reading found no matching title: let ScrapeGraphAI list its openings.
                  if (!checked.url || !checked.note.startsWith("Dibuka: tidak ada posisi")) return checked
                  const ai = yield* UltimateScrape.run(http, {
                    url: checked.url,
                    mode: "ai",
                    timeoutMs: 90_000,
                    prompt: "List every job opening on this page as JSON array items with title, location and link. Return [] if there are none.",
                  }).pipe(Effect.option)
                  if (ai._tag === "None" || ai.value.engine !== "scrapegraph") return checked
                  const titles = [...ai.value.output.matchAll(/"title"s*:s*"([^"]+)"/g)].map((match) => match[1] ?? "")
                  const words = careerInput.role.toLowerCase().split(" ").filter(Boolean)
                  const hit = titles.filter((title) => words.every((word) => title.toLowerCase().includes(word)))
                  return {
                    ...checked,
                    note: hit.length
                      ? `Ada (dibaca ScrapeGraphAI): ${hit.slice(0, 3).join("; ")}`
                      : `Dibuka (ScrapeGraphAI): ${titles.length} lowongan, tidak ada ${careerInput.role}${titles.length ? ` (mis. ${titles.slice(0, 3).join("; ")})` : ""}`,
                  }
                }),
              searchJobs: (jobInput: { query: string; limit: number }) =>
                JobWeb.search((text) => websearch.query({ query: text }, { sessionID: c.sessionID }), jobInput.query).pipe(
                  Effect.map((web) => ({ results: web.results.slice(0, jobInput.limit), ...(web.error ? { error: web.error } : {}) })),
                ),
            })
            const output = yield* deep({
              query: input.query,
              category: input.category,
              ...(input.location ? { location: input.location } : {}),
              ...(input.anchor ? { anchor: input.anchor } : {}),
              ...(input.radiusKm !== undefined ? { radiusKm: input.radiusKm } : {}),
              ...(input.must ? { must: input.must } : {}),
              ...(input.transitLine ? { transitLine: input.transitLine } : {}),
              ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
            })
            const table = "table" in output ? output.table : undefined
            const careers = "careerTable" in output ? output.careerTable : undefined
            return { output, content: table ? `${table}

${careers ? `${careers}

` : ""}${JSON.stringify({ ...output, table: undefined, careerTable: undefined })}` : JSON.stringify(output), metadata: { count: output.candidates.length } }
          }),
      }),
    )
  }),
}
