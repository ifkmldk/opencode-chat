export * as SessionLoopGuard from "./loop-guard.js"

import { createHash } from "crypto"

/** fork: consecutive identical tool calls observed within one session drain. */
export const MAX_REPEAT = 3

/** fork: steps without a new tool call or assistant text before asking the user. */
export const MAX_NO_PROGRESS = 5

/** fork: unconfirmed-completion nudges before the runner stops nagging. */
export const MAX_NAGS = 2

export type Verdict = "continue" | "ask-user" | "stop-with-summary"

export const hashToolCall = (name: string, input: unknown) =>
  createHash("sha256").update(JSON.stringify({ name, input })).digest("hex")

export type State = {
  repeat: number
  lastHash?: string
  quiet: number
}

export const initial = (): State => ({ repeat: 0, quiet: 0 })

export const shouldNag = (nags: number) => nags < MAX_NAGS

export function check(state: State, tool: { name: string; input: unknown } | undefined, progressed: boolean): {
  state: State
  verdict: Verdict
} {
  const quiet = progressed ? 0 : state.quiet + 1
  if (quiet >= MAX_NO_PROGRESS) return { state: { ...state, quiet }, verdict: "ask-user" }
  if (!tool) return { state: { ...state, quiet }, verdict: "continue" }
  const hash = hashToolCall(tool.name, tool.input)
  const repeat = hash === state.lastHash ? state.repeat + 1 : 1
  if (repeat >= MAX_REPEAT) return { state: { repeat, lastHash: hash, quiet }, verdict: "ask-user" }
  return { state: { repeat, lastHash: hash, quiet }, verdict: "continue" }
}
