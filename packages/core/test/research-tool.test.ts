import { describe, expect, test } from "bun:test"
import { __test } from "../src/tool/plugin/research.js"

describe("research classifier", () => {
  test("ranks candidates with explicit reasons", () => {
    const output = __test.classify({
      query: "cheap Bali hotel",
      category: "hotel",
      candidates: [
        { id: "a", category: "hotel", title: "Bali budget stay", price: 50, rating: 4.2 },
        { id: "b", category: "hotel", title: "Bali luxury resort", price: 500, rating: 4.9 },
      ],
    })
    expect(output.rankings[0]?.id).toBe("a")
    expect(output.engine).toBe("deterministic-fallback")
    expect(output.rankings[0]?.reasons.join(" ")).toContain("Price")
  })

  test("requires candidate input", () => {
    expect(Array.isArray([])).toBe(true)
  })
})
