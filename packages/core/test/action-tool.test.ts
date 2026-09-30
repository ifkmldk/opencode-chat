import { describe, expect, test } from "bun:test"
import { __test } from "../src/tool/plugin/action.js"

describe("action executor URL", () => {
  const original = process.env.OPENCODE_ACTION_WEBHOOK
  test("allows an explicit HTTP(S) executor", () => {
    process.env.OPENCODE_ACTION_WEBHOOK = "https://actions.example.test/hook"
    expect(__test.actionWebhook()?.href).toBe("https://actions.example.test/hook")
  })

  test.each(["file:///tmp/action", "ftp://example.test/action", "https://user:pass@example.test/action"]) (
    "rejects unsafe executor %s",
    (value) => {
      process.env.OPENCODE_ACTION_WEBHOOK = value
      expect(() => __test.actionWebhook()).toThrow()
    },
  )

  test("returns undefined when execution is not configured", () => {
    delete process.env.OPENCODE_ACTION_WEBHOOK
    expect(__test.actionWebhook()).toBeUndefined()
  })
  if (original === undefined) delete process.env.OPENCODE_ACTION_WEBHOOK
  else process.env.OPENCODE_ACTION_WEBHOOK = original
})
