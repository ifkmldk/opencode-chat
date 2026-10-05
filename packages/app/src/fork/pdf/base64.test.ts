import { describe, expect, test } from "bun:test"
import { fromBase64, toBase64 } from "./base64"

describe("base64", () => {
  test("round-trips bytes larger than one chunk", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  test("matches the platform encoding for small input", () => {
    const bytes = new TextEncoder().encode("PK\u0003\u0004 hello")
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"))
  })
})
