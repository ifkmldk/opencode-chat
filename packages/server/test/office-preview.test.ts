import { describe, expect, test } from "bun:test"
import { isOpenXml } from "../src/handlers/office"

describe("office preview input check", () => {
  test("accepts a zip signature and refuses legacy binary or text files", () => {
    expect(isOpenXml(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(true)
    expect(isOpenXml(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))).toBe(false)
    expect(isOpenXml(new TextEncoder().encode("{\rtf1 hello}"))).toBe(false)
    expect(isOpenXml(new Uint8Array())).toBe(false)
  })
})
