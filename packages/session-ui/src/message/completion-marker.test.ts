import { describe, expect, test } from "bun:test"
import { hideCompletionMarker } from "./completion-marker"

describe("hideCompletionMarker", () => {
  test("drops the final marker line", () => {
    expect(hideCompletionMarker("Done.\n\n[[OPENCODE_TASK_COMPLETE]]")).toBe("Done.")
    expect(hideCompletionMarker("Done. [[OPENCODE_TASK_COMPLETE]]\n")).toBe("Done.")
  })

  test("a marker-only reply becomes empty", () => {
    expect(hideCompletionMarker("[[OPENCODE_TASK_COMPLETE]]")).toBe("")
  })

  test("hides a partial marker only while streaming", () => {
    expect(hideCompletionMarker("Done.\n\n[[OPENCODE_TA", true)).toBe("Done.")
    expect(hideCompletionMarker("see a[[b]] link", true)).toBe("see a[[b]] link")
    expect(hideCompletionMarker("Done.\n\n[[OPENCODE_TA")).toBe("Done.\n\n[[OPENCODE_TA")
  })

  test("leaves other text alone", () => {
    expect(hideCompletionMarker("Line one\nLine two\n")).toBe("Line one\nLine two\n")
  })
})
