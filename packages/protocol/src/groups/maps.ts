import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

// fork: Settings → Maps. Google Maps data comes from the Gemini API free tier (never billed) behind a daily
// guard; these routes report and change the guard and test the stored key. The key itself is stored through
// the integration routes and is never returned.

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
  }),
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
            "Whether a free-tier Google Maps key is configured, today's grounded-request usage and the limits.",
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
          description: "Turn Google Maps or OpenStreetMap on or off, confirm the free tier, or lower the daily limit.",
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
          summary: "Test the Google Maps key",
          description: "Send one small grounded request with the stored key. It counts toward today's free quota.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "maps", description: "Maps settings and key test (fork)." }))
