export * as AggressivePolicy from "./aggressive-policy.js"

/**
 * fork-aggressive: failure classification + retry budgets + strategy rotation.
 * Pure helpers (no Effect) so they are unit-testable and reusable from
 * `retry.ts`, `llm.ts` drain and `step.ts` without introducing another loop.
 *
 * Aggressive means bounded-aggressive, NOT infinite:
 * - network blips get the largest budget (25x)
 * - timeouts get 10x (up from 3) because a timed-out attempt already waited
 * - rate_limit always honors provider retryAfter capped at 15 minutes
 * - overflow gets 1x + mandatory compact-now (retrying same payload is useless)
 * - auth/quota/policy/config get 0x auto (retrying wastes time, needs user)
 */

export type FailureClass =
  | "network"
  | "timeout"
  | "rate_limit"
  | "provider_internal"
  | "invalid_tool_call"
  | "tool_failed"
  | "overflow"
  | "interrupted"
  | "unknown"

export type BackoffKind = "exp" | "linear"

export type RetryBudget = {
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly backoff: BackoffKind
  readonly jitter: boolean
}

export type AggressiveRetrySettings = {
  readonly byClass: Record<FailureClass, RetryBudget>
  /** Bound for provider-requested retry-after. Keeps existing 15 minutes. */
  readonly retryAfterMaxMs: number
  /** Cap for timed-out attempts. Up from 3 to 10 in aggressive mode. */
  readonly timeoutMaxRetries: number
}

export type RotateAction =
  | "retry-same"
  | "repair-args"
  | "simplify"
  | "split-task"
  | "compact-now"
  | "switch-model"
  | "checkpoint-resume"

export type StrategyDecision = {
  readonly action: RotateAction
  readonly reason: string
  readonly budget: RetryBudget
  readonly attempt: number
}

const exp = (maxAttempts: number, baseDelayMs = 2000, maxDelayMs = 30000): RetryBudget => ({
  maxAttempts,
  baseDelayMs,
  maxDelayMs,
  backoff: "exp",
  jitter: true,
})

export const DEFAULT_BUDGETS: Record<FailureClass, RetryBudget> = {
  network: exp(25),
  timeout: exp(10),
  rate_limit: exp(20),
  provider_internal: exp(15),
  invalid_tool_call: exp(15),
  tool_failed: exp(20),
  overflow: exp(1),
  interrupted: { maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0, backoff: "linear", jitter: false },
  unknown: exp(10),
}

export const DEFAULT_SETTINGS: AggressiveRetrySettings = {
  byClass: DEFAULT_BUDGETS,
  retryAfterMaxMs: 900_000,
  timeoutMaxRetries: 10,
}

/** Minimal shape of AIError needed for classification (avoids importing schema in pure module). */
export type Classifiable = {
  readonly reason: {
    readonly _tag: string
    readonly code?: string | undefined
    readonly classification?: string | undefined
  }
}

export const classifyFailure = (cause: Classifiable): FailureClass => {
  const tag = cause.reason._tag
  switch (tag) {
    case "Transport":
      return cause.reason.code === "Timeout" ? "timeout" : "network"
    case "Timeout":
      return "timeout"
    case "RateLimit":
      return "rate_limit"
    case "ProviderInternal":
      return "provider_internal"
    case "InvalidRequest":
      if (cause.reason.classification === "context-overflow") return "overflow"
      if (cause.reason.classification === "payload-too-large") return "overflow"
      return "invalid_tool_call"
    case "InvalidProviderOutput":
      // Incomplete stream is a cut cable mid-response (network-like).
      // Any other malformed output means the model emitted a bad tool call.
      return cause.reason.classification === "incomplete-stream" ? "network" : "invalid_tool_call"
    case "UnknownProvider":
      return "unknown"
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "UnsupportedOperation":
    case "NoRoute":
      // Deterministic rejections: retrying the same request cannot succeed.
      return "interrupted"
    default:
      return "unknown"
  }
}

export const budgetFor = (cls: FailureClass, settings: AggressiveRetrySettings = DEFAULT_SETTINGS): RetryBudget =>
  settings.byClass[cls]

/**
 * Maps a settled SessionError (runner-visible) to a retry FailureClass.
 * Used by llm.ts drain to pick a rotation strategy on Retry/Continue.
 * Message sniffing covers transports that surface as text (ECONNRESET, socket, timeout).
 */
export type Sessionish = {
  readonly type: string
  readonly message: string
}

export const failureOfSessionError = (error: Sessionish): FailureClass => {
  const type = error.type
  const text = `${error.type} ${error.message}`.toLowerCase()
  if (type === "provider.rate-limit") return "rate_limit"
  if (type === "provider.timeout" || text.includes("timed out") || (text.includes("timeout") && !text.includes("app_ready")))
    return "timeout"
  if (
    text.includes("econnreset") ||
    text.includes("und_err_socket") ||
    text.includes("socket") ||
    text.includes("epipe") ||
    text.includes("etimedout") ||
    text.includes("incomplete-stream") ||
    text.includes("interrupted. continue")
  )
    return "network"
  if (type === "provider.internal") return "provider_internal"
  if (
    text.includes("context-overflow") ||
    text.includes("payload-too-large") ||
    text.includes("context window") ||
    text.includes("too many tokens") ||
    text.includes("token limit")
  )
    return "overflow"
  if (type === "provider.invalid-request" || type === "provider.invalid-output") return "invalid_tool_call"
  if (text.includes("malformed") || text.includes("invalid tool")) return "invalid_tool_call"
  if (type.startsWith("tool.") || type === "unknown" || type === "provider.unknown") {
    if (type.startsWith("tool.")) return "tool_failed"
    return "unknown"
  }
  if (
    type === "aborted" ||
    type === "permission.rejected" ||
    type === "provider.auth" ||
    type === "provider.quota" ||
    type === "provider.content-filter" ||
    type === "provider.unsupported-operation" ||
    type === "provider.no-route"
  )
    return "interrupted"
  return "unknown"
}

/**
 * Rotation ladder: early attempts retry same, then repair/simplify,
 * then split/compact/checkpoint. Overflow always compacts immediately.
 * Interrupted (auth/quota/policy) never spins: checkpoint for user.
 */
export const nextStrategy = (
  failure: FailureClass,
  attempt: number,
  settings: AggressiveRetrySettings = DEFAULT_SETTINGS,
): StrategyDecision => {
  const budget = budgetFor(failure, settings)
  if (failure === "overflow")
    return { action: "compact-now", reason: "context-overflow needs compaction, not retry", budget, attempt }
  if (failure === "interrupted")
    return { action: "checkpoint-resume", reason: "deterministic rejection needs user/config fix", budget, attempt }
  if (failure === "rate_limit")
    return { action: "retry-same", reason: "honor retry-after then retry same request", budget, attempt }
  if (failure === "invalid_tool_call" && attempt >= 2)
    return { action: "repair-args", reason: "malformed tool call needs arg repair", budget, attempt }
  if (attempt <= 2) return { action: "retry-same", reason: "transient, retry same", budget, attempt }
  if (attempt <= 5)
    return {
      action: failure === "tool_failed" ? "repair-args" : "simplify",
      reason: "repeated failure, simplify request",
      budget,
      attempt,
    }
  if (attempt <= 10) return { action: "split-task", reason: "split oversized task", budget, attempt }
  if (attempt <= 15) return { action: "compact-now", reason: "context may be too large, compact", budget, attempt }
  return { action: "checkpoint-resume", reason: "budget nearly exhausted, checkpoint", budget, attempt }
}
