import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Geo } from "../src/maps/geo"
import { MapsCategory } from "../src/maps/categories"
import { Stations } from "../src/maps/stations"
import type { MapsTransit } from "../src/maps/transit-buffer"
import { runDeep, type Deps } from "../src/research/orchestrate"

const serpong = Stations.find("Stasiun Serpong")!

const feature = (index: number, tags: Record<string, string>, meters = 200 + index * 10): MapsTransit.Feature => {
  const point = Geo.destination(serpong, index * 7, meters)
  return {
    id: `osm:node/${index + 1}`,
    name: `Place ${index + 1}`,
    category: Object.entries(tags).map((entry) => entry.join("="))[0] ?? "feature",
    ...point,
    tags: { name: `Place ${index + 1}`, ...tags },
    nearest: { stationId: serpong.id, station: serpong.name, lines: serpong.lines, meters },
  }
}

function deps(calls: { transit: MapsTransit.Input[]; places: { query: string; near?: string; radiusKm?: number }[] }, features: (input: MapsTransit.Input) => MapsTransit.Feature[]): Deps {
  return {
    searchPlaces: (input) => {
      calls.places.push(input)
      return Effect.succeed({ provider: "openstreetmap", places: [], center: { name: input.near ?? "", latitude: serpong.latitude, longitude: serpong.longitude } })
    },
    scrape: () => Effect.succeed({ text: "", source: "none" }),
    nearTransit: (input) => {
      calls.transit.push(input)
      const found = features(input)
      return Effect.succeed({ stations: [serpong], features: found, total: found.length })
    },
  }
}

describe("research_deep places search by OSM tag", () => {
  test("rumah sakit near a station: hospitals around that station, widened once when none is within 1 km", async () => {
    const calls = { transit: [] as MapsTransit.Input[], places: [] as { query: string }[] }
    const deep = runDeep(deps(calls, (input) => (input.radiusMeters >= 3000 ? [feature(0, { amenity: "hospital" }, 1800)] : [])))
    const out = await Effect.runPromise(deep({ query: "rumah sakit terdekat dari stasiun serpong", category: "place" }))
    expect(calls.transit.map((call) => [call.kind, call.stations, call.radiusMeters])).toEqual([
      ["hospital", ["Stasiun Serpong"], 1000],
      ["hospital", ["Stasiun Serpong"], 3000],
    ])
    expect(calls.places).toEqual([])
    expect(out.table).toContain("Place 1")
    expect(out.candidates[0]).toMatchObject({ station: "Serpong", distanceM: 1800 })
    expect(out.limitations.join(" ")).toContain("widened to 3000 m")
  })

  test("tempat wisata near a hotel: the hotel is the centre and the category is an OSM tag search", async () => {
    const calls = { transit: [] as MapsTransit.Input[], places: [] as { query: string; near?: string; radiusKm?: number }[] }
    await Effect.runPromise(runDeep(deps(calls, () => []))({ query: "tempat wisata dekat Pranaya Boutique Hotel BSD", category: "place" }))
    expect(calls.transit).toEqual([])
    expect(calls.places[0]).toMatchObject({ near: "Pranaya Boutique Hotel BSD" })
    expect(calls.places[0]?.radiusKm).toBeUndefined()
    // MapsSearch.places reads the category from the same query and searches Overpass by these tags around the centre.
    expect(MapsCategory.parse(calls.places[0]!.query)).toMatchObject({ kind: "attraction", place: "Pranaya Boutique Hotel BSD" })
  })

  test("hotel near KRL Bogor line stations: every hotel within the radius of the line, up to 50 rows", async () => {
    const calls = { transit: [] as MapsTransit.Input[], places: [] as { query: string }[] }
    const deep = runDeep(deps(calls, () => Array.from({ length: 60 }, (_, index) => feature(index, { tourism: "hotel" }))))
    const out = await Effect.runPromise(deep({ query: "hotel murah dekat stasiun KRL jalur bogor", category: "hotel", maxResults: 50, budget: 500_000 }))
    expect(calls.transit[0]).toMatchObject({ kind: "hotel", lines: ["bogor"], radiusMeters: 1000 })
    expect(out.candidates).toHaveLength(50)
    expect(out.table?.split("\n").filter((line) => /^\| \d+ \|/.test(line))).toHaveLength(50)
    expect(out.limitations.join(" ")).toContain("could not be checked")
  })

  test("hotel in BSD (a city, not a line) searches around BSD without a forced 1 km radius", async () => {
    const calls = { transit: [] as MapsTransit.Input[], places: [] as { query: string; near?: string; radiusKm?: number }[] }
    await Effect.runPromise(runDeep(deps(calls, () => []))({ query: "hotel termurah lokasi di bsd tangerang rating bagus", category: "hotel" }))
    expect(calls.transit).toEqual([])
    expect(calls.places[0]?.near?.toLowerCase()).toContain("bsd")
    expect(calls.places[0]?.radiusKm).toBeUndefined()
  })
})
