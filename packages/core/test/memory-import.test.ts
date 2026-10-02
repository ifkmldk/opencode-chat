import { describe, expect, test } from "bun:test"
import { summarizeDeterministic } from "../src/memory/import.js"

describe("memory import summaries", () => {
  test("skips noise-only sessions", () => {
    const out = summarizeDeterministic({
      source: "opencode",
      externalID: "ses_noise",
      title: "test",
      updatedAt: 1,
      messages: [{ role: "user", text: "test" }],
    })
    expect(out.skipReason).toBe("noise only")
    expect(out.facts).toEqual([])
  })

  test("extracts topic plus decisions with caps", () => {
    const out = summarizeDeterministic({
      source: "claude-code",
      externalID: "abc",
      title: "",
      project: "opencode-chat",
      updatedAt: 2,
      messages: [
        { role: "user", text: "Tolong perbaiki bug annotate di browser panel, jangan pakai window.prompt" },
        { role: "assistant", text: "Siap, saya ganti ke selection bar." },
        { role: "user", text: "Kita memutuskan pakai Leaflet untuk Map tab" },
      ],
    })
    expect(out.skipReason).toBeUndefined()
    expect(out.title.length).toBeGreaterThan(0)
    expect(out.facts.length).toBeGreaterThanOrEqual(1)
    expect(out.facts.every((f) => f.body.length <= 2000 && f.title.length <= 120)).toBe(true)
  })
})
