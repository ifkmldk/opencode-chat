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
import { extractTextFromHTML } from "./webfetch.js"

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
  verified: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["yes", "no", "unknown"] as const))),
  checkedAt: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
  station: Schema.optional(Schema.String),
})
const DeepOutput = Schema.Struct({
  query: Schema.String,
  category: Category,
  providers: Schema.Array(Schema.Struct({ provider: Schema.String, status: Schema.String })),
  candidates: Schema.Array(DeepCandidate),
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
    const guard = (action: string, resources: string[], c: Tool.Context) =>
      permission
        .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: `Research permission denied: ${error.message}`, error })))
    const deep = runDeep({
      searchPlaces: ({ query, near, limit }: { query: string; near?: string; limit: number }) =>
        MapsSearch.make(ctx, kv)
          .places({ query, ...(near ? { near } : {}), limit })
          .pipe(Effect.map((found) => ({ provider: found.provider, places: found.places }))),
      scrape: (url: string) =>
        UltimateScrape.run(http, { url, mode: "stealth" }).pipe(
          Effect.map((out) => ({ text: extractTextFromHTML(out.output), source: out.engine })),
          Effect.orElseSucceed(() => ({ text: "", source: "none" })),
        ),
    })
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
            return { output, content: JSON.stringify(output), metadata: { count: output.candidates.length } }
          }),
      }),
    )
  }),
}
