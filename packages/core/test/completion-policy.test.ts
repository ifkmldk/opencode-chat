import { describe, expect, test } from "bun:test"
import { workedSinceLastUser } from "../src/session/runner/completion-policy"

describe("workedSinceLastUser", () => {
  test("a plain answer has no tool work", () => {
    expect(workedSinceLastUser([{ type: "user" }, { type: "assistant", content: [{ type: "text" }] } as never])).toBe(false)
  })

  test("tool activity after the last user message counts as work", () => {
    expect(workedSinceLastUser([{ type: "user" }, { type: "assistant", content: [{ type: "tool" }] } as never])).toBe(true)
  })

  test("tools used for an earlier question do not count for the new one", () => {
    expect(
      workedSinceLastUser([
        { type: "user" },
        { type: "assistant", content: [{ type: "tool" }] } as never,
        { type: "user" },
        { type: "assistant", content: [{ type: "text" }] } as never,
      ]),
    ).toBe(false)
  })
})
