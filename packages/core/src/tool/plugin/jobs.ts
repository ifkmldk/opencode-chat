export * as JobsTool from "./jobs.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { WebSearch } from "../../websearch.js"
import { JobWeb } from "./job-web.js"

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)), location: Schema.optional(Schema.String.check(Schema.isMaxLength(200))), limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 50 }))) })
const MatchInput = Schema.Struct({ title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)), description: Schema.optional(Schema.String.check(Schema.isMaxLength(20_000))), cvText: Schema.String.check(Schema.isMinLength(20), Schema.isMaxLength(100_000)) })
const Job = Schema.Struct({ id: Schema.String, title: Schema.String, company: Schema.optional(Schema.String), location: Schema.optional(Schema.String), url: Schema.String, description: Schema.optional(Schema.String), postedAt: Schema.optional(Schema.String) })
const Output = Schema.Struct({ provider: Schema.String, jobs: Schema.Array(Job) })
const MatchOutput = Schema.Struct({ score: Schema.Number, matches: Schema.Array(Schema.String), missing: Schema.Array(Schema.String), recommendation: Schema.String })
// fork: Indonesian filler words too, and no trailing dots or dashes ("excel." is "excel", "node.js" stays).
const stop = new Set("a an and are as at be by for from has have in is it of on or that the to with your you will this role job skills experience ability dan yang di ke dari untuk dengan atau pada dalam ini itu sebagai akan dapat bisa memiliki mampu min minimal maks serta juga kami anda kamu".split(" "))
const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9+#]+(?:[.-][a-z0-9+#]+)*/g)?.filter((word) => word.length >= 2 && !stop.has(word)) ?? [])
const endpoint = () => { const value = process.env.OPENCODE_JOBS_API_URL; if (!value) return; const url = new URL(value); if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("OPENCODE_JOBS_API_URL must use http or https"); if (url.username || url.password) throw new Error("OPENCODE_JOBS_API_URL must not contain credentials"); return url }
const request = (url: URL) => Effect.tryPromise({ try: () => fetch(url, { headers: { accept: "application/json", "user-agent": "OpenCode-Chat/2" }, signal: AbortSignal.timeout(20_000) }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json() as unknown }), catch: (error) => error }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Jobs provider request failed: ${error instanceof Error ? error.message : String(error)}. Do not invent listings: use websearch for the same query or tell the user the provider is unavailable.`, error })))

export const Plugin = {
  id: "opencode.tool.jobs",
  effect: Effect.fn("JobsTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const websearch = yield* WebSearch.Service
    yield* ctx.tool.transform((editor) => editor.add({ name: "jobs_search", options: { codemode: false, permission: "jobs.search" }, description: "Search jobs through a user-configured jobs provider, with a location-aware web fallback when unconfigured. Read-only; it never applies, contacts employers, or bypasses site controls.", input: SearchInput, output: Output, execute: (input, context) => Effect.gen(function* () {
      yield* permission.assert({ action: "jobs.search", resources: [input.query], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Jobs permission denied: ${error.message}`, error })))
      const base = yield* Effect.try({ try: endpoint, catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }) }); if (!base) {
        // fork: location-aware web fallback — tanpa provider pun lokasi tidak dibuang.
        const q = [input.query, input.location].filter(Boolean).join(" ")
        const web = yield* JobWeb.search((text) => websearch.query({ query: text }, { sessionID: context.sessionID }), q)
        if (web.results.length === 0 && web.error) return yield* new ToolFailure({ message: `Web search failed: ${web.error.slice(0, 300)}. Tell the user the job search is unavailable; do not list jobs from memory.` })
        const jobs = web.results.slice(0, input.limit ?? 20).map((r) => ({ id: r.url, title: r.title ?? r.url, company: undefined, location: input.location, url: r.url, description: r.content?.slice(0, 2000) }))
        const output = { provider: "web-search", jobs }
        return { output, content: JSON.stringify(output), metadata: { provider: output.provider, count: jobs.length, fallback: true } }
      }
      const url = new URL(base); url.searchParams.set("q", input.query); if (input.location) url.searchParams.set("location", input.location); url.searchParams.set("limit", String(input.limit ?? 20)); const raw = yield* request(url); const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined; const rows: unknown[] = record && Array.isArray(record.jobs) ? record.jobs : Array.isArray(raw) ? raw : []
      const jobs = rows.flatMap((row) => { if (!row || typeof row !== "object") return []; const item = row as Record<string, unknown>; const url = typeof item.url === "string" ? item.url : ""; const title = typeof item.title === "string" ? item.title : ""; if (!url || !title) return []; return [{ id: String(item.id ?? url), title, company: typeof item.company === "string" ? item.company : undefined, location: typeof item.location === "string" ? item.location : undefined, url, description: typeof item.description === "string" ? item.description.slice(0, 10_000) : undefined, postedAt: typeof item.postedAt === "string" ? item.postedAt : undefined }] }).slice(0, input.limit ?? 20)
      const output = { provider: url.hostname, jobs }; return { output, content: JSON.stringify(output), metadata: { provider: output.provider, count: jobs.length } }
    }) })).pipe(Effect.orDie)
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "jobs_match",
        options: { codemode: false, permission: "jobs.match" },
        description: "Compare a CV or profile text to a job description locally and return an explainable match. Read-only; never sends the CV anywhere.",
        input: MatchInput,
        output: MatchOutput,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* permission
              .assert({ action: "jobs.match", resources: [input.title], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } })
              .pipe(Effect.mapError((error) => new ToolFailure({ message: `Jobs match permission denied: ${error.message}`, error })))
            const required = words(`${input.title} ${input.description ?? ""}`)
            const available = words(input.cvText)
            const matches = [...required].filter((word) => available.has(word)).slice(0, 40)
            const missing = [...required].filter((word) => !available.has(word)).slice(0, 40)
            const score = required.size ? Math.round((matches.length / required.size) * 100) : 0
            const recommendation = score >= 75 ? "Strong match" : score >= 50 ? "Possible match" : "Review carefully"
            const output = { score, matches, missing, recommendation }
            return { output, content: JSON.stringify(output), metadata: { score } }
          }),
      }),
    ).pipe(Effect.orDie)
  }),
}
export const __test = { SearchInput, MatchInput, words }
