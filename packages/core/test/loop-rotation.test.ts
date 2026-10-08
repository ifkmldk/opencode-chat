import { describe, expect, test } from "bun:test"
import { check, fingerprintToolCall, initial, normalizeInput } from "../src/session/runner/loop-guard.js"
import { nextStrategy } from "../src/session/runner/aggressive-policy.js"

describe("loop rotation", () => {
  test("identical repeats rotate before asking user", () => {
    let state = initial()
    let verdict = check(state, { name: "read", input: { path: "a" } }, true)
    // first 4 identical stay continue, 5th rotates (soft), 8th asks (hard)
    for (let i = 1; i < 5; i++) {
      verdict = check(verdict.state, { name: "read", input: { path: "a" } }, true)
      expect(["continue", "rotate-strategy"].includes(verdict.verdict)).toBe(true)
    }
    expect(verdict.verdict).toBe("rotate-strategy")
    // rotation ladder suggests repair/simplify, not blind retry
    expect(["repair-args", "simplify", "retry-same"].includes(nextStrategy("tool_failed", 4).action)).toBe(true)
  })

  test("volatile fields do not fake identical", () => {
    const a = fingerprintToolCall("read", { path: "a", attempt: 1, ts: 100 })
    const b = fingerprintToolCall("read", { path: "a", attempt: 2, ts: 200 })
    expect(a.normalizedInputHash).toBe(b.normalizedInputHash)
    expect(a.rawHash).not.toBe(b.rawHash)
  })

  test("quiet steps rotate then ask", () => {
    let s = initial()
    let v = check(s, undefined, false)
    for (let i = 1; i < 5; i++) v = check(v.state, undefined, false)
    expect(v.verdict).toBe("rotate-strategy")
    for (let i = 5; i < 12; i++) v = check(v.state, undefined, false)
    expect(v.verdict).toBe("ask-user")
  })

  test("normalize strips home paths and collapses ws", () => {
    const n = normalizeInput({ cmd: "cat  C:\\Users\\fadhi\\a.txt\n\nls" }) as { cmd: string }
    expect(n.cmd).toContain("<home>")
    expect(n.cmd).not.toContain("  ")
  })
})
