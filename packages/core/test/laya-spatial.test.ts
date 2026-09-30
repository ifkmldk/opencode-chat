import { describe, expect, test } from "bun:test"
import { __test } from "../src/tool/plugin/laya.js"

// fork: off Apple Silicon, Laya's fallback follows a geo_compute ranking in the state instead of matching words.
describe("laya fallback with a spatial ranking", () => {
  test("picks the top-ranked candidate among the criteria", () => {
    const output = __test.fallback({
      state: { query: "hotel near BSD", ranking: [{ id: "a", name: "Hotel A", score: 0.42 }, { id: "b", name: "Hotel B", score: 0.81 }] },
      questions: { best: { type: "choice", instructions: "Which hotel?", criteria: ["Hotel A", "Hotel B"] } },
    })
    expect(output.answers.best?.decision).toBe("Hotel B")
    expect(output.answers.best?.confidence).toBeCloseTo(0.89, 2)
    expect(output.answers.best?.rationale).toContain("weighted score")
  })

  test("finds a ranking nested one level down (a geo_compute output)", () => {
    const output = __test.fallback({
      state: { analysis: { operation: "rank", ranking: [{ id: "x", score: 0.2 }, { id: "y", score: 0.9 }] } },
      questions: { best: { type: "choice", instructions: "Pick", criteria: ["x", "y"] } },
    })
    expect(output.answers.best?.decision).toBe("y")
  })

  test("without a ranking it keeps the word-match fallback", () => {
    const output = __test.fallback({
      state: "the quiet one near the station",
      questions: { best: { type: "choice", instructions: "Pick", criteria: ["loud", "quiet"] } },
    })
    expect(output.answers.best?.decision).toBe("quiet")
  })
})
