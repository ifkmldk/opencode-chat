import { describe, expect, test } from "bun:test"
import { check, hashToolCall, initial, MAX_NAGS, MAX_NO_PROGRESS, MAX_REPEAT, shouldNag } from "../src/session/runner/loop-guard.js"

describe("loop guard", () => {
  test("hashes tool calls deterministically", () => {
    expect(hashToolCall("read", { path: "a" })).toBe(hashToolCall("read", { path: "a" }))
    expect(hashToolCall("read", { path: "a" })).not.toBe(hashToolCall("read", { path: "b" }))
  })

  test("asks the user after repeated identical tool calls", () => {
    let state = initial()
    let verdict = check(state, { name: "read", input: { path: "a" } }, true)
    state = verdict.state
    for (let i = 1; i < MAX_REPEAT - 1; i++) verdict = check((state = verdict.state), { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("continue")
    verdict = check(verdict.state, { name: "read", input: { path: "a" } }, true)
    expect(verdict.verdict).toBe("ask-user")
  })

  test("resets the repeat count when the call changes", () => {
    const first = check(initial(), { name: "read", input: { path: "a" } }, true)
    const second = check(first.state, { name: "read", input: { path: "b" } }, true)
    expect(second.verdict).toBe("continue")
    expect(second.state.repeat).toBe(1)
  })

  test("asks the user after steps without progress", () => {
    let current = initial()
    for (let i = 0; i < MAX_NO_PROGRESS - 1; i++) current = check(current, undefined, false).state
    expect(check(current, undefined, false).verdict).toBe("ask-user")
  })

  test("caps completion nudges", () => {
    expect(shouldNag(0)).toBe(true)
    expect(shouldNag(MAX_NAGS - 1)).toBe(true)
    expect(shouldNag(MAX_NAGS)).toBe(false)
  })
})
