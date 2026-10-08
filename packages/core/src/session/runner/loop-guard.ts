export * as SessionLoopGuard from "./loop-guard.js"

import { createHash } from "crypto"

/** fork-aggressive: consecutive identical tool calls observed within one session drain. 3 -> 8. */
export const MAX_REPEAT = 8

/** fork-aggressive: steps without a new tool call or assistant text before asking the user. 5 -> 12. */
export const MAX_NO_PROGRESS = 12

/** fork-aggressive: unconfirmed-completion nudges before the runner stops nagging. 2 -> 10. */
export const MAX_NAGS = 10

/**
 * fork-aggressive: soft warning threshold (rotate strategy) and hard stop threshold.
 * Aligns with Cline-style soft 5 / hard 12: at soft we rotate, at hard we ask user.
 */
export const SOFT_THRESHOLD = 5
export const HARD_THRESHOLD = 12

export type Verdict = "continue" | "rotate-strategy" | "ask-user" | "stop-with-summary"

export type LoopSettings = {
  readonly maxRepeat: number
  readonly maxNoProgress: number
  readonly maxNags: number
  readonly softThreshold: number
  readonly hardThreshold: number
}

export const DEFAULT_LOOP_SETTINGS: LoopSettings = {
  maxRepeat: MAX_REPEAT,
  maxNoProgress: MAX_NO_PROGRESS,
  maxNags: MAX_NAGS,
  softThreshold: SOFT_THRESHOLD,
  hardThreshold: HARD_THRESHOLD,
}

export type ToolCallFingerprint = {
  readonly name: string
  readonly normalizedInputHash: string
  readonly rawHash: string
}

/**
 * fork: computer observe/wait/wait_idle (and a bare screenshot) legitimately repeat while a window settles or a long task polls
 * it; the call-count limit of the computer tool bounds them instead. Any computer call that contains an input action counts.
 */
const OBSERVING = new Set(["windows", "observe", "wait", "wait_idle", "screenshot"])
export const isExempt = (name: string, input: unknown) => {
  if (name !== "computer") return false
  const actions = (input as { actions?: unknown } | undefined)?.actions
  return Array.isArray(actions) && actions.length > 0 && actions.every((item) => OBSERVING.has(String((item as { action?: unknown } | undefined)?.action)))
}

/** fork-aggressive: normalize volatile fields so legit retries are not counted as false identical. */
export const normalizeInput = (input: unknown): unknown => {
  if (input === null || input === undefined) return input
  if (Array.isArray(input)) return input.map(normalizeInput)
  if (typeof input !== "object") {
    if (typeof input === "string") {
      // Collapse whitespace; strip absolute Windows paths to relative for fingerprint only.
      // Keep original for execution — this is fingerprint-only.
      return input.replace(/\s+/g, " ").replace(/[A-Z]:\\Users\\[^\\\s]*/gi, "<home>").trim()
    }
    return input
  }
  const record = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase()
    // Volatile: timestamps, ids, nonce, attempt counters — ignore for identical detection.
    if (lower.includes("timestamp") || lower === "ts" || lower === "time" || lower === "_ts") continue
    if (lower === "requestid" || lower === "request_id" || lower === "nonce" || lower === "traceid") continue
    if (lower === "attempt" || lower === "retry" || lower === "elapsed") continue
    out[key] = normalizeInput(value)
  }
  return out
}

export const fingerprintToolCall = (name: string, input: unknown): ToolCallFingerprint => ({
  name,
  normalizedInputHash: createHash("sha256").update(JSON.stringify({ name, input: normalizeInput(input) })).digest("hex"),
  rawHash: createHash("sha256").update(JSON.stringify({ name, input })).digest("hex"),
})

export const hashToolCall = (name: string, input: unknown) => fingerprintToolCall(name, input).normalizedInputHash

export type State = {
  repeat: number
  lastHash?: string
  quiet: number
}

export const initial = (): State => ({ repeat: 0, quiet: 0 })

export const shouldNag = (nags: number, settings: LoopSettings = DEFAULT_LOOP_SETTINGS) => nags < settings.maxNags

export function check(
  state: State,
  tool: { name: string; input: unknown } | undefined,
  progressed: boolean,
  settings: LoopSettings = DEFAULT_LOOP_SETTINGS,
): {
  state: State
  verdict: Verdict
} {
  const quiet = progressed ? 0 : state.quiet + 1
  // Aggressive: quiet 8..11 -> rotate (try compaction/split), >=12 -> ask user.
  if (quiet >= settings.maxNoProgress) return { state: { ...state, quiet }, verdict: "ask-user" }
  if (!tool) {
    if (quiet >= settings.softThreshold) return { state: { ...state, quiet }, verdict: "rotate-strategy" }
    return { state: { ...state, quiet }, verdict: "continue" }
  }
  if (isExempt(tool.name, tool.input)) return { state: { ...state, quiet }, verdict: "continue" }
  const hash = hashToolCall(tool.name, tool.input)
  const repeat = hash === state.lastHash ? state.repeat + 1 : 1
  // Aggressive: identical 5..7 -> rotate (repair/simplify), >=8 -> ask user (was 3).
  if (repeat >= settings.maxRepeat) return { state: { repeat, lastHash: hash, quiet }, verdict: "ask-user" }
  if (repeat >= settings.softThreshold)
    return { state: { repeat, lastHash: hash, quiet }, verdict: "rotate-strategy" }
  return { state: { repeat, lastHash: hash, quiet }, verdict: "continue" }
}

