import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/** Smoke guard: desktop PDF rendering requires the Chromium plugins flag in both window paths. */
describe("desktop PDF plugins", () => {
  const appearance = readFileSync(new URL("./appearance.ts", import.meta.url), "utf8")
  const early = readFileSync(new URL("./early.ts", import.meta.url), "utf8")

  test("enables plugins in the main and early window paths", () => {
    expect(appearance).toContain("plugins: true")
    expect(early).toContain("plugins: true")
  })
})
