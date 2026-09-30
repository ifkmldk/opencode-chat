import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { __test as Maps } from "../src/tool/plugin/maps.js"

describe("maps tool inputs", () => {
  test("bounds place search and rejects empty queries", () => {
    expect(Schema.decodeUnknownSync(Maps.SearchInput)({ query: "Jakarta", limit: 3 })).toMatchObject({
      query: "Jakarta",
      limit: 3,
    })
    expect(() => Schema.decodeUnknownSync(Maps.SearchInput)({ query: "" })).toThrow()
    expect(() => Schema.decodeUnknownSync(Maps.SearchInput)({ query: "x", limit: 50 })).toThrow()
  })

  test("routes accept at most 8 stops and known modes", () => {
    expect(() =>
      Schema.decodeUnknownSync(Maps.RouteInput)({ origin: "a", destination: "b", mode: "transit" }),
    ).not.toThrow()
    expect(() => Schema.decodeUnknownSync(Maps.RouteInput)({ origin: "a", destination: "b", mode: "plane" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Maps.RouteInput)({
        origin: "a",
        destination: "b",
        stops: Array.from({ length: 9 }, () => "s"),
      }),
    ).toThrow()
  })
})

describe("geo_compute", () => {
  const compute = (input: Record<string, unknown>) =>
    Maps.compute(Schema.decodeUnknownSync(Maps.GeoInput)(input)) as Record<string, any>

  test("a 1 km geodesic buffer has the area of a 1 km circle", () => {
    const result = compute({ operation: "buffer", origin: { latitude: -6.3, longitude: 106.65 }, radius_m: 1000 })
    expect(result.ring).toHaveLength(48)
    // A 48-gon inscribed in the circle is 0.29% smaller than πr².
    expect(result.squareMeters / (Math.PI * 1000 * 1000)).toBeCloseTo(0.9971, 3)
    expect(result.method).toContain("Karney")
  })

  test("project names the CRS", () => {
    expect(compute({ operation: "project", points: [{ latitude: -6.3, longitude: 106.65, name: "BSD" }] }).crs).toBe(
      "UTM 48S (EPSG:32748)",
    )
  })

  test("clear errors for missing parameters", () => {
    expect(() => compute({ operation: "within", points: [{ latitude: 0, longitude: 0 }] })).toThrow("origin")
    expect(() => compute({ operation: "distance", points: [{ latitude: 0, longitude: 0 }] })).toThrow("at least 2")
    expect(() => compute({ operation: "rank" })).toThrow("candidates")
  })

  test("rank returns the full scoring table", () => {
    const result = compute({
      operation: "rank",
      candidates: [
        { id: "a", values: { minutes: 30, price: 500 } },
        { id: "b", values: { minutes: 20, price: 700 } },
      ],
      criteria: [
        { key: "minutes", weight: 1, better: "lower" },
        { key: "price", weight: 1, better: "lower" },
      ],
    })
    expect(result.ranking.map((row: { id: string; score: number }) => [row.id, row.score])).toEqual([
      ["a", 0.5],
      ["b", 0.5],
    ])
  })
})
