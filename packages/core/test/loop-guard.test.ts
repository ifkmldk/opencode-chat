import { describe, expect, test } from "bun:test"
import {
  check,
  hashToolCall,
  initial,
  MAX_NAGS,
  MAX_NO_PROGRESS,
  MAX_REPEAT,
  SOFT_THRESHOLD,
  shouldNag,
} from "../src/session/runner/loop-guard.js"

describe("loop guard", () => {
  test("hashes tool calls deterministically", () => {
    expect(hashToolCall("read", { path: "a" })).toBe(hashToolCall("read", { path: "a" }))
    expect(hashToolCall("read", { path: "a" })).not.toBe(hashToolCall("read", { path: "b" }))
  })

  test("rotates strategy before asking the user on repeated identical tool calls", () => {
    let state = initial()
    let verdict = check(state, { name: "read", input: { path: "a" } }, true)
    state = verdict.state
    // 1..SOFT-1 stays continue (was continue until MAX_REPEAT-1).
    for (let i = 1; i < SOFT_THRESHOLD - 1; i++) verdict = check((state = verdict.state), { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("continue")
    // SOFT..MAX_REPEAT-1 rotates instead of stopping (aggressive).
    verdict = check(verdict.state, { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("rotate-strategy")
    for (let i = SOFT_THRESHOLD; i < MAX_REPEAT - 1; i++) verdict = check(verdict.state, { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("rotate-strategy")
    verdict = check(verdict.state, { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("ask-user")
  })

  test("resets the repeat count when the call changes", () => {
    const first = check(initial(), { name: "read", input: { path: "a" } }, true)
    const second = check(first.state, { name: "read", input: { path: "b" } }, true)
    expect(second.verdict).toBe("continue")
    expect(second.state.repeat).toBe(1)
  })

  test("rotates before asking the user after steps without progress", () => {
    let current = initial()
    for (let i = 0; i < SOFT_THRESHOLD; i++) {
      const r = check(current, undefined, false)
      current = r.state
      if (i < SOFT_THRESHOLD - 1) expect(r.verdict).toBe("continue")
      else expect(r.verdict).toBe("rotate-strategy")
    }
    for (let i = SOFT_THRESHOLD; i < MAX_NO_PROGRESS - 1; i++) {
      const r = check(current, undefined, false)
      current = r.state
      expect(r.verdict).toBe("rotate-strategy")
    }
    expect(check(current, undefined, false).verdict).toBe("ask-user")
  })

  test("caps completion nudges", () => {
    expect(shouldNag(0)).toBe(true)
    expect(shouldNag(MAX_NAGS - 1)).toBe(true)
    expect(shouldNag(MAX_NAGS)).toBe(false)
  })

  test("ignores volatile fields for identical detection", () => {
    expect(hashToolCall("read", { path: "a", attempt: 1 })).toBe(hashToolCall("read", { path: "a", attempt: 2 }))
    expect(hashToolCall("read", { path: "a", ts: 1 })).toBe(hashToolCall("read", { path: "a", ts: 2 }))
  })
})
