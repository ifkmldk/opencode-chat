export * as SessionCompletionPolicy from "./completion-policy.js"

import { MAX_NAGS, shouldNag } from "./loop-guard.js"

/** fork: caps the unconfirmed-completion nudge so a forgetful model cannot hell-loop. */
export const maxNags = MAX_NAGS

export const allowNudge = shouldNag

/**
 * fork: the completion marker exists to stop a model from quitting half way through WORK (edits, commands, searches). A reply
 * to a plain question has nothing to complete; nagging it made models re-inspect the working folder, repeat their answer and
 * mix unrelated project files into it. So the marker is only demanded after tool activity in the current turn.
 */
/**
 * fork: some models restate the same opening sentence ("Siap, saya cek ulang lebih lengkap...") at the start of every step of a
 * long tool run, so the chat fills with the same line and the work goes in circles. When one opener has been written three or
 * more times in the current turn, the next request carries this steer (transient, never stored).
 */
export const REPEATED_NARRATION_STEER =
  "You have started several steps with the same sentence. Do not write status lines or restate the plan. Use the tool results already in this conversation: either call the next tool with no preamble, or, if you already have enough, write the final answer now. If a tool keeps returning nothing, say so plainly and answer with what you verified."

const opener = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 48)

export const repeatedNarration = (messages: ReadonlyArray<{ readonly type: string }>) => {
  const lastUser = messages.findLastIndex((message) => message.type === "user")
  const counts = new Map<string, number>()
  for (const message of messages.slice(lastUser + 1)) {
    const content = (message as { content?: ReadonlyArray<{ readonly type: string; readonly text?: string }> }).content
    if (message.type !== "assistant" || !Array.isArray(content)) continue
    const first = content.find((part) => part.type === "text" && part.text?.trim())
    const key = opener(first?.text ?? "")
    if (key.length >= 20) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Math.max(0, ...counts.values()) >= 3
}

export const workedSinceLastUser =(messages: ReadonlyArray<{ readonly type: string }>) => {
  const lastUser = messages.findLastIndex((message) => message.type === "user")
  return messages.slice(lastUser + 1).some((message) => {
    const content = (message as { content?: ReadonlyArray<{ readonly type: string }> }).content
    return message.type === "assistant" && Array.isArray(content) && content.some((part) => part.type === "tool")
  })
}
