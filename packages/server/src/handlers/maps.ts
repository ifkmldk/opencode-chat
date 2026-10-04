import { MapsSettings } from "@opencode/core/maps/settings"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

// fork: Settings → Maps. OSM-only (see packages/core/src/maps/settings.ts). The key test
// is kept for compatibility and always reports OSM readiness.
export const MapsHandler = HttpApiBuilder.group(Api, "server.maps", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "maps.status",
        Effect.fn("server.maps.status")(function* () {
          const maps = yield* MapsSettings.Service
          return yield* response(maps.status())
        }),
      )
      .handle(
        "maps.settings",
        Effect.fn("server.maps.settings")(function* (ctx) {
          const maps = yield* MapsSettings.Service
          if (ctx.payload.dailyLimit !== undefined && !(ctx.payload.dailyLimit >= 0))
            return yield* new InvalidRequestError({
              message: "dailyLimit must be zero or more",
              kind: "maps_settings",
              field: "dailyLimit",
            })
          return yield* response(maps.update(ctx.payload))
        }),
      )
      .handle(
        "maps.test",
        Effect.fn("server.maps.test")(function* () {
          const maps = yield* MapsSettings.Service
          const result = yield* maps.test()
          return yield* response(maps.status().pipe(Effect.map((status) => ({ ...result, status }))))
        }),
      )
  }),
)
