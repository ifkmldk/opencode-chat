export * as ResearchDeep from "./research-deep.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { KV } from "../../kv.js"
import { NetGuard } from "../../net-guard.js"
import { Permission } from "../../permission.js"
import { MapsCompany } from "../../maps/company.js"
import { MapsSearch } from "../../maps/search.js"
import { MapsTransit } from "../../maps/transit-buffer.js"
import { MapsAccess } from "../../maps/station-access.js"
import { MapsRide } from "../../maps/transit-ride.js"
import { Stations } from "../../maps/stations.js"
import { runDeep, type DeepResult, type Deps } from "../../research/orchestrate.js"
import { ScrapeChromium } from "../../scrape/chromium.js"
import { UltimateScrape } from "../../scrape/engine.js"
import { ScrapeExtract } from "../../scrape/extract.js"
import { WebSearch } from "../../websearch.js"
import { MemoryStore } from "../../memory/store.js"
import { extractTextFromHTML } from "./webfetch.js"
import { JobWeb } from "./job-web.js"
import { JobBoards } from "../../scrape/jobboards.js"
import { Boards } from "../../scrape/boards.js"

const Cats = ["job", "hotel", "flight", "product", "youtube", "place", "event", "course", "service", "other"] as const
const Category = Schema.Literals(Cats)
const DeepInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)).annotate({
    description: "The user's request in their own words (role, place, salary, distance, must-haves).",
  }),
  category: Category,
  location: Schema.optional(Schema.String).annotate({
    description: 'City or area searched, e.g. "Jakarta", "Tangerang Selatan". Optional when the query names stations or lines.',
  }),
  budget: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1000000000 }))).annotate({
    description: "Price ceiling in rupiah for hotels/places (0-1e9). OSM has no prices, so it is reported, not filtered. For jobs use minSalary.",
  }),
  minSalary: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1000000000 }))).annotate({
    description:
      'Monthly salary floor in rupiah for jobs, e.g. 11000000 for "di atas 11 juta" (read from the query when omitted). Only listings whose disclosed salary stays below it are dropped; undisclosed salaries are kept.',
  }),
  maxResults: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 300 }))).annotate({
    description: "Rows in the main table: jobs 1-300 (default 150), places 1-50 (default 20).",
  }),
  anchor: Schema.optional(Schema.String).annotate({
    description: 'The place distances are measured from: "Stasiun Sudirman", "Menara Astra", "Pranaya Boutique Hotel BSD". Read from the query ("dekat X", "dari X") when omitted.',
  }),
  radiusKm: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 100 }))).annotate({
    description: 'Radius in km, 0.1-100 ("<1km" → 1). Default: 1 near stations or for walking, else 3 for places.',
  }),
  travelMode: Schema.optional(Schema.Literals(["driving", "walking", "transit"] as const)).annotate({
    description: "walking adds OSRM walking meters/minutes to each row.",
  }),
  must: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Must-have attributes checked on each place\'s own website, e.g. ["carport", "ac", "furnished"].',
  }),
  transitLine: Schema.optional(Schema.String).annotate({
    description: `Stations the results must be near: "KRL" or "semua jalur" (every KRL line), "KRL Rangkasbitung", "jalur Bogor", or one station "Stasiun Serpong". Read from the query when omitted (only rail words count; a city name is not a line).`,
  }),
  lines: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: `Line ids instead of transitLine: ${Stations.LINES.map((line) => line.id).join(", ")}.`,
  }),
  accessMode: Schema.optional(Schema.Literals(["walk", "walk_or_one_transit"] as const)).annotate({
    description:
      'How offices may be reached from the stations. walk (default): on foot from the best station entrance, without paying. walk_or_one_transit: also ONE direct bus/TransJakarta/Mikrotrans/angkot ride from a station ("atau 1x naik transum langsung dari stasiun"); read from the query when omitted.',
  }),
})
const DeepCandidate = Schema.Struct({
  id: Schema.String,
  category: Category,
  title: Schema.String,
  provider: Schema.optional(Schema.String),
  company: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  address: Schema.optional(Schema.String),
  latitude: Schema.optional(Schema.Number),
  longitude: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  distanceM: Schema.optional(Schema.Number),
  walkingM: Schema.optional(Schema.Number),
  anchor: Schema.optional(Schema.String),
  travelMode: Schema.optional(Schema.Literals(["driving", "walking", "transit"] as const)),
  travelMinutes: Schema.optional(Schema.Number),
  verified: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["yes", "no", "unknown"] as const))),
  checkedAt: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.Literals(["openstreetmap", "web-search", "scraped"] as const)),
  priceNote: Schema.optional(Schema.String),
  station: Schema.optional(Schema.String),
  salary: Schema.optional(Schema.String),
  posted: Schema.optional(Schema.String),
})
const DeepOutput = Schema.Struct({
  query: Schema.String,
  category: Category,
  providers: Schema.Array(Schema.Struct({ provider: Schema.String, status: Schema.String, message: Schema.optional(Schema.String) })),
  candidates: Schema.Array(DeepCandidate),
  table: Schema.optional(Schema.String),
  unlocatedTable: Schema.optional(Schema.String),
  outsideTable: Schema.optional(Schema.String),
  companyTable: Schema.optional(Schema.String),
  careerTable: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  anchor: Schema.optional(Schema.Struct({ name: Schema.String, latitude: Schema.Number, longitude: Schema.Number })),
  limitations: Schema.optional(Schema.Array(Schema.String)),
  checkedAt: Schema.optional(Schema.Number),
})

/** research_deep: one run that searches, locates, measures, verifies and returns complete tables. */
export const Plugin = {
  id: "opencode.tool.research-deep",
  effect: Effect.fn("ResearchDeep.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const kv = yield* KV.Service
    const http = yield* HttpClient.HttpClient
    const websearch = yield* WebSearch.Service
    const memory = yield* MemoryStore.Service
    const maps = MapsSearch.make(ctx, kv)
    const guard = (action: string, resources: string[], c: Tool.Context) =>
      permission
        .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: `Research permission denied: ${error.message}`, error })))
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "research_deep",
        options: { codemode: false, permission: "research.deep" },
        description: [
          "Deep research in one call. Jobs: reads Jobstreet, LinkedIn, Glints, Kalibrr, Dealls, Indeed, KitaLulus, Loker.id and Karir for every role phrase in every relevant city, plus web search and LinkedIn/Instagram/Facebook/X posts;",
          "locates every employer's office on OpenStreetMap, measures the straight and walking distance to the nearest requested KRL/MRT/LRT station (walks start at the station's best entrance; or the anchor), applies the salary floor (undisclosed salaries kept),",
          "keeps data-analyst look-alikes only when related (Mirip = BI, reporting, business/product/pricing analyst, data engineer…; network, admin, accounting, data entry, sales titles are dropped and counted),",
          "and with accessMode walk_or_one_transit also accepts offices one direct bus/angkot ride from a station (Akses column: 1x <route>, stops and walks).",
          "and near stations also lists every named company within the radius with its career page checked. Returns tables: table (matches), unlocatedTable (office not found, with reason), outsideTable (outside the radius), companyTable, careerTable.",
          "Places (hotel, wisata, rumah sakit, …): OSM tag search around the anchor or around the stations, must-haves read on each place's own website. Runs take minutes for station-wide job searches.",
        ].join(" "),
        input: DeepInput,
        output: DeepOutput,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard("research.deep", [input.query], c)
            const status = (text: string) => c.progress({ status: text })
            const aiLeft = { count: 5 }
            // fork: built per-execution so searches use the calling session, not a stale id.
            const deep = runDeep({
              searchPlaces: (request) =>
                maps
                  .places({
                    query: request.query,
                    ...(request.near ? { near: request.near } : {}),
                    limit: request.limit,
                    ...(request.radiusKm !== undefined ? { radiusKm: request.radiusKm } : {}),
                  })
                  .pipe(
                    Effect.map((found) => ({
                      provider: found.provider,
                      places: found.places,
                      ...(found.center ? { center: found.center } : {}),
                      ...(found.notice ? { notice: found.notice } : {}),
                      ...(found.total !== undefined ? { total: found.total } : {}),
                      ...(found.radiusMeters !== undefined ? { radiusMeters: found.radiusMeters } : {}),
                    })),
                  ),
              // fork: notes the user saved as already applied / rejected (title starts with "Sudah dilamar", "Ditolak", "Applied" or "Rejected").
              excluded: () =>
                memory.list().pipe(
                  Effect.map((entries) => entries.filter((entry) => /^(sudah dilamar|ditolak|applied|rejected)/i.test(entry.title)).map((entry) => `${entry.title} ${entry.body}`)),
                  Effect.orElseSucceed(() => [] as string[]),
                ),
              // A plain GET first (job pages carry their JSON-LD in the HTML), then the headless browser. The stealth plan's
              // Python tiers can download a browser and take minutes per page, too slow for dozens of pages in one run.
              scrape: (url: string) =>
                UltimateScrape.run(http, { url, mode: "fast" }).pipe(
                  Effect.flatMap((out) =>
                    ScrapeExtract.isUseful(out.output)
                      ? Effect.succeed({ text: extractTextFromHTML(out.output), source: out.engine })
                      : Effect.tryPromise(async () => {
                          const page = await ScrapeChromium.render(url, { timeoutMs: 30_000, waitMs: 2500 })
                          // A redirect or script navigation can land on a private host; its text is dropped.
                          await NetGuard.assertPublicUrl(page.finalUrl)
                          return page
                        }).pipe(
                          Effect.map((page) => ({
                            text: [
                              ScrapeExtract.textOf(ScrapeExtract.mainContent(page.html)),
                              ScrapeExtract.jobPostingsMarkdown(ScrapeExtract.jobPostings(page.html)),
                            ].join("\n\n"),
                            source: "chromium",
                          })),
                        ),
                  ),
                  Effect.orElseSucceed(() => ({ text: "", source: "none" })),
                ),
              board: (request) =>
                Effect.promise(() => {
                  // Board progress arrives from plain promises; it is forwarded at most every few seconds.
                  const last = { at: 0 }
                  return Boards.fetchAll({
                    phrases: request.phrases,
                    cities: request.cities,
                    ...(request.kind ? { kind: request.kind } : {}),
                    ...(request.onListings ? { onListings: request.onListings } : {}),
                    onProgress: (line) => {
                      if (Date.now() - last.at < 5000) return
                      last.at = Date.now()
                      Effect.runFork(status(`Papan lowongan: ${line}`))
                    },
                  })
                }).pipe(
                  Effect.map((found) => ({
                    ...found,
                    manual: Boards.manualSearch({ role: request.phrases[0] ?? "", cities: request.cities }),
                  })),
                ),
              careers: (request) =>
                Effect.gen(function* () {
                  const hits = yield* websearch
                    .query({ query: `${request.company} karir career lowongan` }, { sessionID: c.sessionID })
                    .pipe(Effect.map((web) => web.results), Effect.orElseSucceed(() => [] as readonly { url: string }[]))
                  const checked = yield* Effect.promise(() => JobBoards.careerCheck(hits, request))
                  // The page opened but plain reading found no matching title: let ScrapeGraphAI list its openings. It runs an
                  // LLM per page, so only for the first few such pages of a run.
                  if (!checked.url || checked.match !== "no" || !checked.note.startsWith("Dibuka: tidak ada posisi") || aiLeft.count <= 0) return checked
                  aiLeft.count -= 1
                  const ai = yield* UltimateScrape.run(http, {
                    url: checked.url,
                    mode: "ai",
                    timeoutMs: 60_000,
                    prompt: "List every job opening on this page as JSON array items with title, location and link. Return [] if there are none.",
                  }).pipe(Effect.option)
                  if (ai._tag === "None" || ai.value.engine !== "scrapegraph") return checked
                  const titles = [...ai.value.output.matchAll(/"title"\s*:\s*"([^"]+)"/g)].map((match) => match[1] ?? "")
                  const hit = titles.filter((title) => JobBoards.fits(title, request.phrases))
                  return {
                    ...checked,
                    match: hit.length ? ("yes" as const) : ("no" as const),
                    note: hit.length
                      ? `Ada (dibaca ScrapeGraphAI): ${hit.slice(0, 3).join("; ")}`
                      : `Dibuka (ScrapeGraphAI): ${titles.length} lowongan, tidak ada ${request.phrases.join(" / ")}${titles.length ? ` (mis. ${titles.slice(0, 3).join("; ")})` : ""}`,
                  }
                }),
              searchJobs: (request) =>
                request.exact
                  ? websearch.query({ query: request.query }, { sessionID: c.sessionID }).pipe(
                      Effect.map((web) => ({ results: web.results.slice(0, request.limit) })),
                      Effect.catch((error) => Effect.succeed({ results: [], error: error.message })),
                    )
                  : JobWeb.search((text) => websearch.query({ query: text }, { sessionID: c.sessionID }), request.query).pipe(
                      Effect.map((web) => ({ results: web.results.slice(0, request.limit), ...(web.error ? { error: web.error } : {}) })),
                    ),
              geocode: (text) =>
                Effect.tryPromise(() => MapsSearch.locatePoint(text)).pipe(Effect.orElseSucceed(() => undefined)),
              locateCompany: (request) => MapsCompany.lookup(request),
              nearTransit: (request) => MapsTransit.nearStations(request),
              walking: (pairs) => MapsTransit.walking(pairs),
              stationWalking: (pairs) => MapsAccess.fromStations(pairs),
              transitRoutes: (stations) => Effect.promise(() => MapsRide.routesNear(stations)),
              progress: status,
            } satisfies Deps)
            const output = yield* deep({
              query: input.query,
              category: input.category,
              ...(input.location ? { location: input.location } : {}),
              ...(input.anchor ? { anchor: input.anchor } : {}),
              ...(input.radiusKm !== undefined ? { radiusKm: input.radiusKm } : {}),
              ...(input.must ? { must: input.must } : {}),
              ...(input.transitLine ? { transitLine: input.transitLine } : {}),
              ...(input.lines ? { lines: input.lines } : {}),
              ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
              ...(input.minSalary !== undefined ? { minSalary: input.minSalary } : {}),
              ...(input.budget !== undefined ? { budget: input.budget } : {}),
              ...(input.travelMode ? { travelMode: input.travelMode } : {}),
              ...(input.accessMode ? { accessMode: input.accessMode } : {}),
            })
            return { output, content: content(output), metadata: { count: output.candidates.length } }
          }),
      }),
    )
  }),
}

/**
 * What the model reads: the summary and rules first (so a truncated answer still has them), then each table once.
 * Candidates repeat the table rows and stay in the structured output only.
 */
function content(output: DeepResult) {
  const tables = [
    ["Hasil", output.table],
    ["Lokasi kantor belum ketemu (unlocatedTable)", output.unlocatedTable],
    ["Di luar radius (outsideTable)", output.outsideTable],
    ["Perusahaan dalam radius stasiun (companyTable)", output.companyTable],
    ["Halaman karir (careerTable)", output.careerTable],
  ].flatMap(([title, table]) => (table ? [`### ${title}\n\n${table}`] : []))
  const facts = {
    query: output.query,
    category: output.category,
    providers: output.providers,
    ...(output.anchor ? { anchor: output.anchor } : {}),
    limitations: output.limitations,
    checkedAt: output.checkedAt,
  }
  return [...(output.summary ? [output.summary] : []), JSON.stringify(facts), ...tables].join("\n\n")
}
