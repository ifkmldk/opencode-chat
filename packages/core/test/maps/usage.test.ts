import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { KV } from "../../src/kv.js"
import { MapsUsage } from "../../src/maps/usage.js"

function memory(): KV.Interface {
  const items = new Map<string, KV.Value>()
  return {
    get: (key) => Effect.succeed(items.get(key)),
    set: (key, value) => Effect.sync(() => void items.set(key, value)),
    remove: (key) => Effect.sync(() => void items.delete(key)),
    scan: () => Effect.succeed({ entries: [] }),
  }
}

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

// fork: OSM-only — guard quota tidak dipakai; OSM selalu lolos.
describe("OSM-only maps usage", () => {
  test("blocked is always undefined, settings report OSM on", async () => {
    const kv = memory()
    expect(await run(MapsUsage.blocked(kv))).toBeUndefined()
    expect(await run(MapsUsage.settings(kv))).toMatchObject({ googleEnabled: false, osmEnabled: true })
    expect(await run(MapsUsage.update(kv, { osmEnabled: true }))).toMatchObject({ osmEnabled: true })
    expect(await run(MapsUsage.used(kv))).toBe(0)
    expect(await run(MapsUsage.record(kv))).toBe(0)
    expect(MapsUsage.pacificDay(new Date("2026-09-30T06:59:00Z"))).toBe("2026-09-29")
  })
})
