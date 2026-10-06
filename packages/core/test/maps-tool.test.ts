import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Tool } from "../src/tool"
import { definition, execute } from "../src/tool/runtime"
import { __test as Maps } from "../src/tool/plugin/maps.js"

const context = {
  sessionID: Session.ID.make("ses_maps_tool"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_maps_tool"),
  id: Tool.CallID.make("call_maps_tool"),
  progress: () => Effect.void,
} satisfies Tool.Context

describe("maps tool inputs", () => {
  test("bounds place search and rejects empty queries", () => {
    expect(Schema.decodeUnknownSync(Maps.SearchInput)({ query: "Jakarta", limit: 3 })).toMatchObject({
      query: "Jakarta",
      limit: 3,
    })
    expect(() => Schema.decodeUnknownSync(Maps.SearchInput)({ query: "" })).toThrow()
    expect(Schema.decodeUnknownSync(Maps.SearchInput)({ query: "x", limit: 50 }).limit).toBe(50)
    expect(() => Schema.decodeUnknownSync(Maps.SearchInput)({ query: "x", limit: 51 })).toThrow()
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

describe("geo_compute with an origin and many centres", () => {
  const compute = (input: Record<string, unknown>) =>
    Maps.compute(Schema.decodeUnknownSync(Maps.GeoInput)(input)) as Record<string, any>
  const sudirman = { latitude: -6.202408, longitude: 106.823449, name: "Sudirman" }
  const palmerah = { latitude: -6.20792, longitude: 106.797232, name: "Palmerah" }
  const menaraAstra = { latitude: -6.2070842, longitude: 106.8211384, name: "Menara Astra" }
  const kompas = { latitude: -6.2082299, longitude: 106.7945137, name: "Kompas Gramedia" }

  test("distance measures from the origin to every point, even a single one", () => {
    const one = compute({ operation: "distance", origin: sudirman, points: [menaraAstra] })
    expect(one.distances).toHaveLength(1)
    expect(one.distances[0].name).toBe("Menara Astra")
    expect(one.distances[0].meters).toBeGreaterThan(500)
    expect(one.distances[0].meters).toBeLessThan(650)
    const two = compute({ operation: "distance", origin: sudirman, points: [menaraAstra, kompas] })
    expect(two.distances.map((row: { name: string }) => row.name)).toEqual(["Menara Astra", "Kompas Gramedia"])
    expect(two.distances[1].meters).toBeGreaterThan(3000)
    expect(() => compute({ operation: "distance", origin: sudirman, points: [] })).toThrow("at least 1")
  })

  test("near_any gives each point its nearest centre and counts those within the radius", () => {
    const result = compute({
      operation: "near_any",
      points: [menaraAstra, kompas],
      centres: [sudirman, palmerah],
      radius_m: 500,
    })
    expect(
      result.items.map((item: { name: string; nearest: { name: string } }) => [item.name, item.nearest.name]),
    ).toEqual([
      ["Menara Astra", "Sudirman"],
      ["Kompas Gramedia", "Palmerah"],
    ])
    expect(result.items.map((item: { within: boolean }) => item.within)).toEqual([false, true])
    expect(result.count).toBe(1)
    expect(() => compute({ operation: "near_any", points: [kompas] })).toThrow("centres")
  })

  test("a misspelt field is rejected instead of silently ignored", () => {
    expect(() => Schema.decodeUnknownSync(Maps.GeoInput)({ operation: "distance_matrix", cands: [] })).toThrow("excess")
  })

  test("the runtime reports the unknown key to the model", async () => {
    const tool: Info = {
      name: "geo_compute",
      description: "geo",
      input: Maps.GeoInput,
      execute: (input) =>
        Effect.sync(() => ({ content: JSON.stringify(Maps.compute(input as typeof Maps.GeoInput.Type)) })),
    }
    const failure = await Effect.runPromise(
      Effect.flip(execute(tool, { operation: "distance", origin: sudirman, point: [kompas] }, context)),
    )
    expect(failure.message).toContain("point")
    expect(failure.message).toContain("excess")
  })
})

describe("maps_near_transit", () => {
  test("input defaults are optional, kinds are the category list, and unknown keys are rejected", () => {
    expect(Schema.decodeUnknownSync(Maps.TransitInput)({})).toEqual({})
    expect(
      Schema.decodeUnknownSync(Maps.TransitInput)({ kind: "hospital", lines: ["bogor"], radius_m: 500 }),
    ).toMatchObject({
      kind: "hospital",
    })
    expect(() => Schema.decodeUnknownSync(Maps.TransitInput)({ kind: "spaceport" })).toThrow()
    expect(() => Schema.decodeUnknownSync(Maps.TransitInput)({ radius: 1000 })).toThrow("excess")
    expect(() => Schema.decodeUnknownSync(Maps.TransitInput)({ radius_m: 6000 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Maps.TransitInput)({ limit: 2001 })).toThrow()
  })

  test("the model sees every limit in the field descriptions", () => {
    const schema = definition({
      name: "maps_near_transit",
      description: "x",
      input: Maps.TransitInput,
      execute: () => Effect.succeed({ content: "" }),
    }).inputSchema as { properties: Record<string, { description?: string }> }
    expect(schema.properties.radius_m!.description).toContain("50-5000 (default 1000)")
    expect(schema.properties.limit!.description).toContain("1-2000 (default 500)")
    expect(schema.properties.lines!.description).toContain("rangkasbitung")
    expect(schema.properties.kind!.description).toContain("attraction = wisata")
    const search = definition({
      name: "maps_search",
      description: "x",
      input: Maps.SearchInput,
      execute: () => Effect.succeed({ content: "" }),
    }).inputSchema as { properties: Record<string, { description?: string }> }
    expect(search.properties.limit!.description).toContain("1-50")
  })

  test("the table for the model starts with the totals and lists every row", () => {
    const row = Maps.transitRow(
      {
        id: "osm:way/155110242",
        name: "Kompas Gramedia",
        category: "building=company",
        latitude: -6.2082299,
        longitude: 106.7945137,
        address: "Jalan Palmerah Barat 29-32",
        website: "https://www.kompasgramedia.com/",
        tags: { building: "company", name: "Kompas Gramedia", "addr:street": "Jalan Palmerah Barat" },
        nearest: { stationId: "osm:node/4877432803", station: "Palmerah", lines: ["rangkasbitung"], meters: 303 },
      },
      { meters: 2433, seconds: 1750 },
      true,
    )
    expect(row).toMatchObject({
      straightMeters: 303,
      walkingMeters: 2433,
      walkingMinutes: 29,
      osm: { building: "company" },
    })
    expect(row.walkingNote).toContain("snapped far away")
    const text = Maps.transitTable({
      what: "office",
      radiusMeters: 1000,
      stations: 83,
      lines: ["bogor", "cikarang", "rangkasbitung", "tangerang", "tanjung-priok"],
      total: 2,
      named: 1,
      withWebsite: 1,
      returned: 1,
      perLine: { rangkasbitung: 2 },
      features: [row],
    })
    const lines = text.split("\n")
    expect(lines[0]).toContain("2 office features within 1000 m (straight line) of 83 stations")
    expect(lines[0]).toContain("raise limit")
    expect(lines.at(-1)).toBe(
      "1 | Kompas Gramedia | building=company | Palmerah (rangkasbitung) | 303 | 2433 / 29 (routing snapped far away) | kompasgramedia.com | Jalan Palmerah Barat 29-32 | osm:way/155110242",
    )
  })
})
