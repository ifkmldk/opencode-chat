import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { __test as classifierTest } from "../src/classifier/engine"
import { ResearchTool } from "../src/tool/plugin/research"

describe("inputs that real models send", () => {
  test("classifier accepts one question object and a map of questions alike", () => {
    const { Input, fallback } = classifierTest
    const decode = Schema.decodeUnknownSync(Input)
    const single = decode({ state: { ranking: [{ name: "A", score: 0.9 }] }, questions: { type: "choice", instructions: "pick", criteria: ["A", "B"] }, question: "mana yang terbaik?" })
    const out = fallback(single)
    expect(Object.keys(out.answers)).toEqual(["answer"])
    expect(out.answers.answer?.decision).toBe("A")
    expect(out.warnings.join(" ")).toContain("mana yang terbaik?")
    const map = decode({ state: {}, questions: { best: { type: "choice", instructions: "pick", criteria: ["A"] } } })
    expect(Object.keys(fallback(map).answers)).toEqual(["best"])
  })

  test("research_classify takes `verified` as text or booleans without rejecting the call", () => {
    const decode = Schema.decodeUnknownSync(ResearchTool.__test.Classify)
    const input = decode({
      query: "hotel bsd",
      category: "hotel",
      candidates: [
        { id: "1", category: "hotel", title: "A", verified: "yes" },
        { id: "2", category: "hotel", title: "B", verified: [true, false] },
        { id: "3", category: "hotel", title: "C", verified: { location: "yes" } },
      ],
    })
    expect(input.candidates).toHaveLength(3)
    expect(ResearchTool.__test.classify(input).rankings).toHaveLength(3)
  })
})
