import { describe, expect, test } from "bun:test"
import {
  budgetFor,
  classifyFailure,
  DEFAULT_SETTINGS,
  nextStrategy,
} from "../src/session/runner/aggressive-policy.js"

describe("aggressive-policy", () => {
  test("classifies transport timeout vs network", () => {
    expect(classifyFailure({ reason: { _tag: "Transport", code: "Timeout" } })).toBe("timeout")
    expect(classifyFailure({ reason: { _tag: "Transport", code: "ECONNRESET" } })).toBe("network")
    expect(classifyFailure({ reason: { _tag: "Timeout" } })).toBe("timeout")
  })

  test("rate limit and provider internal map correctly", () => {
    expect(classifyFailure({ reason: { _tag: "RateLimit" } })).toBe("rate_limit")
    expect(classifyFailure({ reason: { _tag: "ProviderInternal" } })).toBe("provider_internal")
  })

  test("overflow maps from context-overflow and payload-too-large", () => {
    expect(classifyFailure({ reason: { _tag: "InvalidRequest", classification: "context-overflow" } })).toBe("overflow")
    expect(classifyFailure({ reason: { _tag: "InvalidRequest", classification: "payload-too-large" } })).toBe("overflow")
    expect(classifyFailure({ reason: { _tag: "InvalidRequest" } })).toBe("invalid_tool_call")
  })

  test("incomplete stream is network-like, other malformed output is invalid tool call", () => {
    expect(classifyFailure({ reason: { _tag: "InvalidProviderOutput", classification: "incomplete-stream" } })).toBe(
      "network",
    )
    expect(classifyFailure({ reason: { _tag: "InvalidProviderOutput" } })).toBe("invalid_tool_call")
  })

  test("deterministic rejections never auto-spin", () => {
    for (const tag of ["Authentication", "QuotaExceeded", "ContentPolicy", "UnsupportedOperation", "NoRoute"]) {
      expect(classifyFailure({ reason: { _tag: tag } })).toBe("interrupted")
    }
    expect(budgetFor("interrupted", DEFAULT_SETTINGS).maxAttempts).toBe(0)
  })

  test("budgets are bounded-aggressive, not infinite", () => {
    expect(budgetFor("network", DEFAULT_SETTINGS).maxAttempts).toBe(25)
    expect(budgetFor("timeout", DEFAULT_SETTINGS).maxAttempts).toBe(10)
    expect(budgetFor("tool_failed", DEFAULT_SETTINGS).maxAttempts).toBe(20)
    expect(DEFAULT_SETTINGS.timeoutMaxRetries).toBe(10)
    expect(DEFAULT_SETTINGS.retryAfterMaxMs).toBe(900_000)
  })

  test("rotation ladder escalates instead of blind retry", () => {
    expect(nextStrategy("network", 1).action).toBe("retry-same")
    expect(nextStrategy("invalid_tool_call", 3).action).toBe("repair-args")
    expect(nextStrategy("tool_failed", 4).action).toBe("repair-args")
    expect(nextStrategy("network", 6).action).toBe("split-task")
    expect(nextStrategy("overflow", 1).action).toBe("compact-now")
    expect(nextStrategy("interrupted", 1).action).toBe("checkpoint-resume")
    expect(nextStrategy("network", 20).action).toBe("checkpoint-resume")
  })
})
