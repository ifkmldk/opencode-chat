export * as MapsSettings from "./settings.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Integration } from "../integration.js"
import { KV } from "../kv.js"

import { MapsUsage } from "./usage.js"

// fork: OSM-only (Google/Gemini removed — no key, never billed). Settings → Maps
// hanya membaca status OSM. GEMINI_* dipertahankan sebagai konstanta mati agar
// import lama tidak pecah, tapi tidak pernah dipakai.

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
      // fork: OSM-only — google selalu reported off/unconfigured, OSM selalu on.
      return {
        google: {
          configured: false,
          enabled: false,
          confirmedFree: false,
          usedToday: 0,
          exhaustedToday: false,
          dailyLimit: 0,
          maxDailyLimit: 0,
          freeDaily: 0,
          resetsAt: new Date().toISOString(),
        },
        osm: { enabled: true },
      }
    })

    return Service.of({
      status,
      update: Effect.fn("MapsSettings.update")(function* (patch) {
        yield* MapsUsage.update(kv, patch)
        return yield* status()
      }),
      test: Effect.fn("MapsSettings.test")(function* () {
        // fork: OSM-only — tidak ada key yang diuji; status OSM selalu siap.
        return { ok: true, message: "OSM-only: no key needed, OpenStreetMap is always on." }
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [KV.node, Integration.node] })
