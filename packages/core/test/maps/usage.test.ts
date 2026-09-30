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

describe("daily guard for free Google Maps requests", () => {
  test("stays off until the owner confirms the key's project is on the Free tier", async () => {
    const kv = memory()
    expect(await run(MapsUsage.blocked(kv))).toBe("unconfirmed")
    await run(MapsUsage.update(kv, { confirmedFree: true }))
    expect(await run(MapsUsage.blocked(kv))).toBeUndefined()
    await run(MapsUsage.update(kv, { googleEnabled: false }))
    expect(await run(MapsUsage.blocked(kv))).toBe("disabled")
  })

  test("stops at the daily limit, which can never exceed 450 of Google's free 500", async () => {
    const kv = memory()
    expect((await run(MapsUsage.update(kv, { confirmedFree: true, dailyLimit: 10_000 }))).dailyLimit).toBe(450)
    await run(MapsUsage.update(kv, { dailyLimit: 2 }))
    const now = new Date("2026-09-29T10:00:00Z")
    expect(await run(MapsUsage.record(kv, now))).toBe(1)
    expect(await run(MapsUsage.blocked(kv, now))).toBeUndefined()
    await run(MapsUsage.record(kv, now))
    expect(await run(MapsUsage.blocked(kv, now))).toBe("daily_limit")
    // A new Pacific day starts from zero.
    expect(await run(MapsUsage.used(kv, new Date("2026-09-30T08:00:00Z")))).toBe(0)
  })

  test("days follow Pacific time, and the reset is the next Pacific midnight", () => {
    // 06:59 UTC on Sep 30 is still Sep 29 in Los Angeles (PDT, UTC-7).
    expect(MapsUsage.pacificDay(new Date("2026-09-30T06:59:00Z"))).toBe("2026-09-29")
    expect(MapsUsage.pacificDay(new Date("2026-09-30T07:00:00Z"))).toBe("2026-09-30")
    expect(MapsUsage.nextReset(new Date("2026-09-29T10:00:00Z")).toISOString()).toBe("2026-09-30T07:00:00.000Z")
    // Winter (PST, UTC-8).
    expect(MapsUsage.nextReset(new Date("2026-12-01T12:00:00Z")).toISOString()).toBe("2026-12-02T08:00:00.000Z")
  })

  test("ignores corrupt stored settings", async () => {
    const kv = memory()
    await run(kv.set("maps:settings:v1", "garbage"))
    expect(await run(MapsUsage.settings(kv))).toEqual({
      googleEnabled: true,
      confirmedFree: false,
      dailyLimit: 450,
      osmEnabled: true,
    })
  })

  test("a quota 429 from Google blocks Google for the rest of the Pacific day", async () => {
    const kv = memory()
    await run(MapsUsage.update(kv, { confirmedFree: true }))
    const now = new Date("2026-09-29T10:00:00Z")
    expect(await run(MapsUsage.blocked(kv, now))).toBeUndefined()
    await run(MapsUsage.markExhausted(kv, now))
    expect(await run(MapsUsage.exhausted(kv, now))).toBe(true)
    expect(await run(MapsUsage.blocked(kv, now))).toBe("daily_limit")
    expect(await run(MapsUsage.blocked(kv, new Date("2026-09-30T08:00:00Z")))).toBeUndefined()
  })
})
