import { describe, expect, test } from "bun:test"
import { buildMemoryBlock } from "../src/memory/recall.js"

describe("memory recall", () => {
  test("empty vault renders nothing", () => {
    expect(buildMemoryBlock([])).toBe("")
  })

  test("renders entries with ids and caps output", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({
      id: `mem-${i}-abcdef`,
      scope: "global" as const,
      kind: "fact" as const,
      title: `Fact ${i}`,
      body: "x".repeat(500),
      source: "agent" as const,
    }))
    const block = buildMemoryBlock(big)
    expect(block).toContain("## Remembered context (vault)")
    expect(block).toContain("memory:mem-0-ab")
    // fork-aggressive: cap 4096 -> 8192 (see recall.ts MAX_BYTES).
    expect(new TextEncoder().encode(block).byteLength).toBeLessThanOrEqual(8192)
  })
})
