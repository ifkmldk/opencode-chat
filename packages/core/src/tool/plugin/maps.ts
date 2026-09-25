export * as MapsTool from "./maps.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"

const SearchInput = Schema.Struct({ query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)), limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10 }))) })
const RouteInput = Schema.Struct({ origin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)), destination: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)), mode: Schema.optional(Schema.Literals(["driving", "walking", "cycling"] as const)) })
const Place = Schema.Struct({ name: Schema.String, address: Schema.String, latitude: Schema.Number, longitude: Schema.Number, category: Schema.optional(Schema.String), url: Schema.optional(Schema.String) })
const SearchOutput = Schema.Struct({ provider: Schema.String, query: Schema.String, places: Schema.Array(Place) })
const RouteOutput = Schema.Struct({ provider: Schema.String, mode: Schema.String, origin: Place, destination: Place, distanceMeters: Schema.Number, durationSeconds: Schema.Number })

const requestJson = (url: URL) => Effect.tryPromise({ try: () => fetch(url, { headers: { accept: "application/json", "user-agent": "OpenCode-Chat/2" }, signal: AbortSignal.timeout(20_000) }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json() as unknown }), catch: (error) => error }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Maps provider request failed: ${error instanceof Error ? error.message : String(error)}`, error })))

export const Plugin = {
  id: "opencode.tool.maps",
  effect: Effect.fn("MapsTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool.transform((editor) => {
      editor.add({ name: "maps_search", options: { codemode: false, permission: "maps.search" }, description: "Search for places using OpenStreetMap Nominatim. Read-only; does not book or contact anyone.", input: SearchInput, output: SearchOutput, execute: (input, context) => Effect.gen(function* () {
        yield* permission.assert({ action: "maps.search", resources: [input.query], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Maps permission denied: ${error.message}`, error })))
        const url = new URL("https://nominatim.openstreetmap.org/search"); url.searchParams.set("q", input.query); url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", String(input.limit ?? 5)); url.searchParams.set("addressdetails", "1")
        const raw = yield* requestJson(url); const rows = Array.isArray(raw) ? raw : []
        const places = rows.flatMap((row) => { if (!row || typeof row !== "object") return []; const item = row as Record<string, unknown>; const latitude = Number(item.lat); const longitude = Number(item.lon); if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []; return [{ name: String(item.display_name ?? input.query), address: String(item.display_name ?? ""), latitude, longitude, category: typeof item.category === "string" ? item.category : undefined, url: typeof item.osm_id === "string" ? `https://www.openstreetmap.org/node/${item.osm_id}` : undefined }] })
        const output = { provider: "openstreetmap", query: input.query, places }; return { output, content: JSON.stringify(output), metadata: { provider: output.provider, count: places.length } }
      }) })
    }).pipe(Effect.orDie)
  }),
}
export const __test = { SearchInput, RouteInput }
