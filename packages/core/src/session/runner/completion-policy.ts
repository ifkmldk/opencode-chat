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
export const workedSinceLastUser = (messages: ReadonlyArray<{ readonly type: string }>) => {
  const lastUser = messages.findLastIndex((message) => message.type === "user")
  return messages.slice(lastUser + 1).some((message) => {
    const content = (message as { content?: ReadonlyArray<{ readonly type: string }> }).content
    return message.type === "assistant" && Array.isArray(content) && content.some((part) => part.type === "tool")
  })
}
