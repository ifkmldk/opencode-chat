export * as MapsUsage from "./usage.js"

import { Effect, Option, Schema } from "effect"
import { KV } from "../kv.js"

// fork: the daily guard for grounded Google Maps requests. The Gemini free tier allows 500 per day (Pacific
// time); stopping at 450 means an answer never fails halfway on a 429, and the tools answer from OpenStreetMap
// instead. Settings live in KV so the owner can change them from Settings → Maps.

export const FREE_DAILY = 500
export const MAX_LIMIT = 450

export type Settings = {
  /** Use Google Maps data (via Gemini) when a key is configured. */
  readonly googleEnabled: boolean
  /** The owner confirmed the key's project shows "Billing Tier: Free" in AI Studio. Google stays off until then. */
  readonly confirmedFree: boolean
  /** Grounded requests allowed per Pacific day, at most MAX_LIMIT. */
  readonly dailyLimit: number
  /** Use the free OpenStreetMap services (search fallback, routing, POIs). */
  readonly osmEnabled: boolean
}

const defaults: Settings = { googleEnabled: true, confirmedFree: false, dailyLimit: MAX_LIMIT, osmEnabled: true }
const settingsKey = "maps:settings:v1"
const usageKey = (day: string) => `maps:usage:v1:${day}`
const exhaustedKey = (day: string) => `maps:exhausted:v1:${day}`

const Stored = Schema.Struct({
  googleEnabled: Schema.optional(Schema.Boolean),
  confirmedFree: Schema.optional(Schema.Boolean),
  dailyLimit: Schema.optional(Schema.Number),
  osmEnabled: Schema.optional(Schema.Boolean),
})
const decodeStored = Schema.decodeUnknownOption(Stored)

export const settings = Effect.fn("MapsUsage.settings")(function* (kv: KV.Interface) {
  const stored = decodeStored(yield* kv.get(settingsKey))
  return normalize({ ...defaults, ...(Option.isSome(stored) ? stored.value : {}) })
})

export const update = Effect.fn("MapsUsage.update")(function* (kv: KV.Interface, patch: Partial<Settings>) {
  const next = normalize({ ...(yield* settings(kv)), ...patch })
  yield* kv.set(settingsKey, next)
  return next
})

export const used = Effect.fn("MapsUsage.used")(function* (kv: KV.Interface, now = new Date()) {
  const value = yield* kv.get(usageKey(pacificDay(now)))
  return typeof value === "number" && Number.isFinite(value) ? value : 0
})

/** Why Google can't be used right now, or undefined when a grounded request may be sent. */
export const blocked = Effect.fn("MapsUsage.blocked")(function* (kv: KV.Interface, now = new Date()) {
  const current = yield* settings(kv)
  if (!current.googleEnabled) return "disabled" as const
  if (!current.confirmedFree) return "unconfirmed" as const
  if ((yield* used(kv, now)) >= current.dailyLimit) return "daily_limit" as const
  if (yield* exhausted(kv, now)) return "daily_limit" as const
  return undefined
})

/** Google said its free quota is gone today (429 on every free model), whatever our own count says. */
export const exhausted = Effect.fn("MapsUsage.exhausted")(function* (kv: KV.Interface, now = new Date()) {
  return (yield* kv.get(exhaustedKey(pacificDay(now)))) === true
})

export const markExhausted = Effect.fn("MapsUsage.markExhausted")(function* (kv: KV.Interface, now = new Date()) {
  yield* kv.set(exhaustedKey(pacificDay(now)), true)
})

/** Counts one grounded request before it is sent, so failed attempts are counted too. */
export const record = Effect.fn("MapsUsage.record")(function* (kv: KV.Interface, now = new Date()) {
  const key = usageKey(pacificDay(now))
  const next = (yield* used(kv, now)) + 1
  yield* kv.set(key, next)
  return next
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
