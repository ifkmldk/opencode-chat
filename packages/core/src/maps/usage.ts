export * as MapsUsage from "./usage.js"

import { Effect } from "effect"
import { KV } from "../kv.js"

// fork: OSM-only (Google/Gemini removed — no key, never billed). Guard quota tidak
// lagi dipakai; fungsi dipertahankan agar import lama tidak pecah (selalu lolos OSM).

export const FREE_DAILY = 0
export const MAX_LIMIT = 0

export type Settings = {
  /** Google dinonaktifkan permanen (OSM-only). */
  readonly googleEnabled: boolean
  /** Tidak dipakai lagi (OSM-only). */
  readonly confirmedFree: boolean
  /** Tidak dipakai lagi (OSM-only). */
  readonly dailyLimit: number
  /** Use the free OpenStreetMap services (search, routing, POIs). */
  readonly osmEnabled: boolean
}

const defaults: Settings = { googleEnabled: false, confirmedFree: false, dailyLimit: 0, osmEnabled: true }
const settingsKey = "maps:settings:v1"
const usageKey = (day: string) => `maps:usage:v1:${day}`
const exhaustedKey = (day: string) => `maps:exhausted:v1:${day}`

export const settings = Effect.fn("MapsUsage.settings")(function* (kv: KV.Interface) {
  void kv
  return defaults
})

export const update = Effect.fn("MapsUsage.update")(function* (kv: KV.Interface, _patch: Partial<Settings>) {
  void kv
  return defaults
})

export const used = Effect.fn("MapsUsage.used")(function* (kv: KV.Interface, _now = new Date()) {
  void kv
  return 0
})

/** OSM-only: Google tidak pernah dipakai, jadi tidak pernah blocked. */
export const blocked = Effect.fn("MapsUsage.blocked")(function* (kv: KV.Interface, _now = new Date()) {
  void kv
  return undefined
})

export const exhausted = Effect.fn("MapsUsage.exhausted")(function* (kv: KV.Interface, _now = new Date()) {
  void kv
  return false
})

export const markExhausted = Effect.fn("MapsUsage.markExhausted")(function* (kv: KV.Interface, _now = new Date()) {
  void kv
})

export const record = Effect.fn("MapsUsage.record")(function* (kv: KV.Interface, _now = new Date()) {
  void kv
  return 0
})

export function pacificDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

/** The next Pacific midnight, when Google resets the free daily quota. */
export function nextReset(now: Date) {
  const today = pacificDay(now)
  const [year, month, day] = today.split("-").map(Number)
  // Pacific midnight is 07:00 or 08:00 UTC depending on daylight saving; pick the one that starts a new day.
  const candidates = [7, 8].map((hour) => new Date(Date.UTC(year!, month! - 1, day! + 1, hour)))
  return (
    candidates.find((candidate) => {
      const before = new Date(candidate.getTime() - 60_000)
      return pacificDay(candidate) !== today && pacificDay(before) === today
    }) ?? candidates[1]!
  )
}

function normalize(value: Settings): Settings {
  const limit = Number.isFinite(value.dailyLimit) ? Math.round(value.dailyLimit) : MAX_LIMIT
  return { ...value, dailyLimit: Math.max(0, Math.min(MAX_LIMIT, limit)) }
}
