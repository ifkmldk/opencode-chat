export * as MapsSettings from "./settings.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Integration } from "../integration.js"
import { KV } from "../kv.js"
import { MapsError } from "./error.js"
import { MapsGoogle } from "./google.js"
import { MapsUsage } from "./usage.js"

// fork: what Settings → Maps reads and changes. The Gemini key is an integration credential (entered through
// the integration routes, never returned); settings and today's usage live in KV (see ./usage.ts).

export const GEMINI_INTEGRATION = Integration.ID.make("google-maps-gemini")
export const GEMINI_ENV = "OPENCODE_MAPS_GEMINI_KEY"

export type Status = {
  readonly google: {
    readonly configured: boolean
    readonly source?: "credential" | "env"
    readonly enabled: boolean
    readonly confirmedFree: boolean
    readonly usedToday: number
    /** Google answered 429 on every free model today, so Google is skipped until the reset. */
    readonly exhaustedToday: boolean
    readonly dailyLimit: number
    readonly maxDailyLimit: number
    readonly freeDaily: number
    readonly resetsAt: string
  }
  readonly osm: { readonly enabled: boolean }
}

export type TestResult = {
  readonly ok: boolean
  readonly message: string
  readonly model?: string
  readonly grounded?: boolean
}

export interface Interface {
  readonly status: () => Effect.Effect<Status>
  readonly update: (patch: Partial<MapsUsage.Settings>) => Effect.Effect<Status>
  readonly test: () => Effect.Effect<TestResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MapsSettings") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const integration = yield* Integration.Service

    const status = Effect.fn("MapsSettings.status")(function* () {
      const connection = yield* integration.connection.active(GEMINI_INTEGRATION)
      const settings = yield* MapsUsage.settings(kv)
      const now = new Date()
      return {
        google: {
          configured: !!connection,
          source: connection ? (connection.type === "env" ? ("env" as const) : ("credential" as const)) : undefined,
          enabled: settings.googleEnabled,
          confirmedFree: settings.confirmedFree,
          usedToday: yield* MapsUsage.used(kv, now),
          exhaustedToday: yield* MapsUsage.exhausted(kv, now),
          dailyLimit: settings.dailyLimit,
          maxDailyLimit: MapsUsage.MAX_LIMIT,
          freeDaily: MapsUsage.FREE_DAILY,
          resetsAt: MapsUsage.nextReset(now).toISOString(),
        },
        osm: { enabled: settings.osmEnabled },
      }
    })

    return Service.of({
      status,
      update: Effect.fn("MapsSettings.update")(function* (patch) {
        yield* MapsUsage.update(kv, patch)
        return yield* status()
      }),
      test: Effect.fn("MapsSettings.test")(function* () {
        const connection = yield* integration.connection.active(GEMINI_INTEGRATION)
        if (!connection) return { ok: false, message: "No Google Maps key is saved yet." }
        const settings = yield* MapsUsage.settings(kv)
        // Even the test waits for the Free-tier confirmation, so it can't be billed on a paid project.
        if (!settings.confirmedFree)
          return { ok: false, message: "Confirm that the key's project is on the Free tier first." }
        if ((yield* MapsUsage.used(kv)) >= settings.dailyLimit || (yield* MapsUsage.exhausted(kv)))
          return { ok: false, message: "Today's free limit is used up." }
        const credential = yield* integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        if (credential?.type !== "key") return { ok: false, message: "The saved key could not be read." }
        yield* MapsUsage.record(kv)
        return yield* Effect.tryPromise({ try: () => MapsGoogle.test(credential.key), catch: (error) => error }).pipe(
          Effect.map(
            (outcome): TestResult => ({
              ok: true,
              message: outcome.grounded
                ? "Connected: Google Maps grounding works."
                : "Connected, but the answer had no Google Maps sources.",
              model: outcome.model,
              grounded: outcome.grounded,
            }),
          ),
          Effect.catch((error) =>
            Effect.gen(function* () {
              if (error instanceof MapsError && error.kind === "rate_limited") yield* MapsUsage.markExhausted(kv)
              return { ok: false, message: error instanceof Error ? error.message : String(error) } satisfies TestResult
            }),
          ),
        )
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [KV.node, Integration.node] })
