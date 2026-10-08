export * as ResumeTokenStore from "./resume-token.js"

import { Effect } from "effect"
import { KV } from "../../kv.js"

/**
 * fork-aggressive: durable resume token.
 * Survives process death (failed_external_process_exit like Cline mk7yy):
 * KV row `resume-token/<sessionID>` holds last good step + checklist.
 * Written each milestone from llm.ts drain, cleared on terminal success.
 */

export type ChecklistItem = {
  readonly id: string
  readonly title: string
  readonly done: boolean
}

export type ResumeToken = {
  readonly sessionID: string
  readonly step: number
  readonly updatedAt: number
  readonly checklist: ReadonlyArray<ChecklistItem>
  readonly completedFiles: ReadonlyArray<string>
  readonly lastGoodSnapshot?: string | undefined
  readonly nextAction: string
}

const keyFor = (sessionID: string) => `resume-token/${sessionID}`

const isToken = (value: unknown): value is ResumeToken => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v["sessionID"] === "string" &&
    typeof v["step"] === "number" &&
    typeof v["updatedAt"] === "number" &&
    Array.isArray(v["checklist"]) &&
    Array.isArray(v["completedFiles"]) &&
    typeof v["nextAction"] === "string"
  )
}

export const writeResumeToken = (token: ResumeToken) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    yield* kv.set(keyFor(token.sessionID), token as unknown as KV.Value)
  })

export const loadResumeToken = (sessionID: string) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const raw = yield* kv.get(keyFor(sessionID))
    if (!isToken(raw)) return undefined
    if (raw.sessionID !== sessionID) return undefined
    return raw
  })

export const clearResumeToken = (sessionID: string) =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    yield* kv.remove(keyFor(sessionID))
  })

export const formatResumeNote = (token: ResumeToken) =>
  [
    `Resume from step ${token.step} (saved ${new Date(token.updatedAt).toISOString()}).`,
    `Next: ${token.nextAction}`,
    ...token.checklist.map((item) => `- [${item.done ? "x" : " "}] ${item.title}`),
  ].join("\n")
