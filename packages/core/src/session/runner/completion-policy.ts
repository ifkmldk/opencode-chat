export * as SessionCompletionPolicy from "./completion-policy.js"

import { MAX_NAGS, shouldNag } from "./loop-guard.js"

/** fork: caps the unconfirmed-completion nudge so a forgetful model cannot hell-loop. */
export const maxNags = MAX_NAGS

export const allowNudge = shouldNag
