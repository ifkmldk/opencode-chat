export * as JobsTool from "./jobs.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)), location: Schema.optional(Schema.String.check(Schema.isMaxLength(200))), limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 50 }))) })
const Job = Schema.Struct({ id: Schema.String, title: Schema.String, company: Schema.optional(Schema.String), location: Schema.optional(Schema.String), url: Schema.String, description: Schema.optional(Schema.String), postedAt: Schema.optional(Schema.String) })
const Output = Schema.Struct({ provider: Schema.String, jobs: Schema.Array(Job) })
const endpoint = () => { const value = process.env.OPENCODE_JOBS_API_URL; if (!value) return; const url = new URL(value); if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("OPENCODE_JOBS_API_URL must use http or https"); if (url.username || url.password) throw new Error("OPENCODE_JOBS_API_URL must not contain credentials"); return url }
const request = (url: URL) => Effect.tryPromise({ try: () => fetch(url, { headers: { accept: "application/json", "user-agent": "OpenCode-Chat/2" }, signal: AbortSignal.timeout(20_000) }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json() as unknown }), catch: (error) => error }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Jobs provider request failed: ${error instanceof Error ? error.message : String(error)}`, error })))

export const Plugin = {
  id: "opencode.tool.jobs",
  effect: Effect.fn("JobsTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool.transform((editor) => editor.add({ name: "jobs_search", options: { codemode: false, permission: "jobs.search" }, description: "Search jobs through a user-configured jobs provider. Read-only; it never applies, contacts employers, or bypasses site controls.", input: SearchInput, output: Output, execute: (input, context) => Effect.gen(function* () {
      yield* permission.assert({ action: "jobs.search", resources: [input.query], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Jobs permission denied: ${error.message}`, error })))
      const base = yield* Effect.try({ try: endpoint, catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }) }); if (!base) return yield* new ToolFailure({ message: "Jobs search is not configured. Set OPENCODE_JOBS_API_URL to enable it." })
      const url = new URL(base); url.searchParams.set("q", input.query); if (input.location) url.searchParams.set("location", input.location); url.searchParams.set("limit", String(input.limit ?? 20)); const raw = yield* request(url); const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined; const rows: unknown[] = record && Array.isArray(record.jobs) ? record.jobs : Array.isArray(raw) ? raw : []
      const jobs = rows.flatMap((row) => { if (!row || typeof row !== "object") return []; const item = row as Record<string, unknown>; const url = typeof item.url === "string" ? item.url : ""; const title = typeof item.title === "string" ? item.title : ""; if (!url || !title) return []; return [{ id: String(item.id ?? url), title, company: typeof item.company === "string" ? item.company : undefined, location: typeof item.location === "string" ? item.location : undefined, url, description: typeof item.description === "string" ? item.description.slice(0, 10_000) : undefined, postedAt: typeof item.postedAt === "string" ? item.postedAt : undefined }] }).slice(0, input.limit ?? 20)
      const output = { provider: url.hostname, jobs }; return { output, content: JSON.stringify(output), metadata: { provider: output.provider, count: jobs.length } }
    }) })).pipe(Effect.orDie)
  }),
}
export const __test = { SearchInput }
