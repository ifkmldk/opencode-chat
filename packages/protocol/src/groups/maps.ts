import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

// fork: Settings → Maps. OSM-only (Google/Gemini removed per user decision — no key,
// never billed). These routes report OSM status; google fields are kept optional so older
// clients do not break, but are always reported off/unconfigured.

export const MapsStatus = Schema.Struct({
  google: Schema.Struct({
    configured: Schema.Boolean,
    source: Schema.optional(Schema.Literals(["credential", "env"] as const)),
    enabled: Schema.Boolean,
    confirmedFree: Schema.Boolean,
    usedToday: Schema.Number,
    exhaustedToday: Schema.Boolean,
    dailyLimit: Schema.Number,
    maxDailyLimit: Schema.Number,
    freeDaily: Schema.Number,
    resetsAt: Schema.String,
  }).annotate({ description: "Deprecated: always off/unconfigured (OSM-only)." }),
  osm: Schema.Struct({ enabled: Schema.Boolean }),
}).annotate({ identifier: "MapsStatus" })

export const MapsSettingsPatch = Schema.Struct({
  googleEnabled: Schema.optional(Schema.Boolean),
  confirmedFree: Schema.optional(Schema.Boolean),
  dailyLimit: Schema.optional(Schema.Number),
  osmEnabled: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MapsSettingsPatch" })

export const MapsTestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
  model: Schema.optional(Schema.String),
  grounded: Schema.optional(Schema.Boolean),
  status: MapsStatus,
}).annotate({ identifier: "MapsTestResult" })

export const MapsGroup = HttpApiGroup.make("server.maps")
  .add(
    HttpApiEndpoint.get("maps.status", "/api/experimental/maps/status", {
      query: LocationQuery,
      success: Location.response(MapsStatus),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "maps.status",
          summary: "Maps status",
          description:
            "Whether OpenStreetMap is on (always). Google fields are deprecated and always report off/unconfigured (OSM-only).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("maps.settings", "/api/experimental/maps/settings", {
      query: LocationQuery,
      payload: MapsSettingsPatch,
      success: Location.response(MapsStatus),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "maps.settings",
          summary: "Update maps settings",
          description: "Turn OpenStreetMap on or off. Google fields are deprecated (OSM-only).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("maps.test", "/api/experimental/maps/test", {
      query: LocationQuery,
      success: Location.response(MapsTestResult),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "maps.test",
          summary: "Test maps status",
          description: "Returns OSM readiness (always on, no key). Kept for compatibility; performs no key test.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "maps", description: "OSM-only maps status (fork, no key, never billed)." }))
