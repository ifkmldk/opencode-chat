import { describe, expect, test } from "bun:test"
import { RESPONSE_CONTRACT, RESPONSE_KEY } from "../src/response/contract.js"

describe("response contract", () => {
  test("has a stable instruction key", () => {
    expect(RESPONSE_KEY).toBe("core/response-contract")
  })

  test("covers structured answers, sources, and verify/next", () => {
    expect(RESPONSE_CONTRACT).toContain("Summary")
    expect(RESPONSE_CONTRACT).toContain("Google Maps")
    expect(RESPONSE_CONTRACT).toContain("Verify")
    expect(RESPONSE_CONTRACT).toContain("Next")
  })
})
