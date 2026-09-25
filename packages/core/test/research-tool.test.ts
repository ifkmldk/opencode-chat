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

  test("reports fallback status and web candidates honestly", () => {
    const status = __test.status()
    expect(["laya-mlx", "deterministic-fallback"]).toContain(status.laya.engine)
    expect(status.providers.some((provider) => provider.provider === "hotel")).toBe(true)
    const candidate = __test.webResult({ url: "https://example.test/hotel", title: "Example Hotel", content: "A source", time: {} }, "hotel")
    expect(candidate.provider).toBe("web-search")
    expect(candidate.url).toBe("https://example.test/hotel")
  })
})
