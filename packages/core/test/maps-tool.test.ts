import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { __test as Maps } from "../src/tool/plugin/maps.js"

describe("maps tool inputs", () => {
  test("bounds place search and rejects empty queries", () => {
    expect(Schema.decodeUnknownSync(Maps.SearchInput)({ query: "Jakarta", limit: 3 })).toMatchObject({ query: "Jakarta", limit: 3 })
    expect(() => Schema.decodeUnknownSync(Maps.SearchInput)({ query: "" })).toThrow()
  })
})
