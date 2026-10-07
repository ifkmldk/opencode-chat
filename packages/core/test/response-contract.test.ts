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

  // fork: "meets every hard constraint; top 3 first" cut a 100-row job answer to 10 rows of "unknown".
  test("keeps every candidate not shown to break a constraint and uses the job table columns", () => {
    expect(RESPONSE_CONTRACT).not.toContain("top 3 first")
    expect(RESPONSE_CONTRACT).not.toContain("meets every hard constraint")
    expect(RESPONSE_CONTRACT).toContain("never only the top 3")
    expect(RESPONSE_CONTRACT).toContain("Unverified means unknown, not failed")
    expect(RESPONSE_CONTRACT).toContain("second table")
    expect(RESPONSE_CONTRACT).toContain(
      "# | Posisi | Perusahaan | Kantor (alamat) | Stasiun terdekat | Jarak lurus / jalan kaki | Gaji | Diposting | Kecocokan | Sumber | Link lamar",
    )
    expect(RESPONSE_CONTRACT).toContain("tidak dicantumkan")
  })
})
