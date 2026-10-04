import { describe, expect, test } from "bun:test"
import { MapsGoogle } from "../../src/maps/google.js"
import { MapsError } from "../../src/maps/error.js"

// fork: OSM-only — shim runtime selalu gagal jujur, tidak pernah bill.
describe("OSM-only google shim", () => {
  test("places/ask/test/generate throw disabled", async () => {
    for (const run of [
      () => MapsGoogle.places("k", { query: "x", limit: 1 }),
      () => MapsGoogle.ask("k", { question: "x" }),
      () => MapsGoogle.test("k"),
      () => MapsGoogle.generate("k", "x"),
    ]) {
      const error = await run().catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(MapsError)
      expect((error as MapsError).message).toContain("OSM-only")
    }
  })

  test("parseItems/normalize/similar helpers stay", () => {
    expect(MapsGoogle.parseItems('[{"name":"A"}]')).toHaveLength(1)
  })
})
