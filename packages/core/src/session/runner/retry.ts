export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"
import { Bus } from "../../bus.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { budgetFor, classifyFailure } from "./aggressive-policy.js"

export { isRetryable }

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a session for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

// Exponential from 2s capped at 10s per gap, for 25 retries: 2, 4, 8, then 10 x 22, about 234s of
// waiting when every attempt fails (with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
// fork-aggressive: general allowance 10 -> 25 (network blips), timeout cap 3 -> 10.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(25),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a step for most of an hour. Cap those attempts well below it.
// fork-aggressive: 3 -> 10 (bounded-aggressive, see aggressive-policy.ts DEFAULT_BUDGETS.timeout).
const MAX_TIMEOUT_RETRIES = 10

const isTimeout = (error: AIError) =>
  error.reason._tag === "Timeout" || (error.reason._tag === "Transport" && error.reason.code === "Timeout")

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule)
    let attempt = 1
    let timeouts = 0
    return (input: Input) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
        if (!next) return { retry: false as const }
        const [, duration] = next
        attempt++
        if (isTimeout(input.cause)) timeouts++
        // fork-aggressive: class-aware budgets (see aggressive-policy.ts).
        // overflow/interrupted never retry same payload (compaction/checkpoint handles them).
        // timeout retries even when isRetryable is false (safe: request never completed).
        const failure = classifyFailure(input.cause)
        const budget = budgetFor(failure)
        const used = attempt - 1
        const allowed =
          failure === "interrupted" || failure === "overflow"
            ? false
            : isTimeout(input.cause)
              ? timeouts <= MAX_TIMEOUT_RETRIES && used <= budget.maxAttempts
              : input.retry && used <= budget.maxAttempts
        const delay = Math.ceil(Duration.toMillis(duration))
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt,
          decision: allowed ? { retry: true, delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) return event.decision
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0 ? Math.ceil(event.decision.delay) : delay
        return { retry: true as const, attempt, delay: normalized }
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* policy(sessionID)
    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
    }) =>
      Effect.gen(function* () {
        const scheduled = yield* Clock.currentTimeMillis
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at: scheduled + input.decision.delay,
          error: input.error,
        })
        const remaining = Math.max(0, scheduled + input.decision.delay - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(remaining))
      })
    return { decide, wait }
  })
