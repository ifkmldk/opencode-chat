import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Geo } from "../src/maps/geo"
import { MapsAccess } from "../src/maps/station-access"
import { MapsRide } from "../src/maps/transit-ride"
import { Stations } from "../src/maps/stations"
import { extractConstraints } from "../src/research/constraints"
import { runDeep, type Deps } from "../src/research/orchestrate"
import type { JobBoards } from "../src/scrape/jobboards"

const OWNER =
  "Carikan perusahaan yang buka loker data analyst atau sejenisnya posisi yg relevan dengan gaji di atas 11 juta. lokasi perusahaannya wajib radius <1km dari KRL, boleh dari line rangkas bitung atau yg line lain. yg jelas dari stasiun KRL tsb bisa jalan kaki hemat ongkos."
const palmerah = Stations.find("Stasiun Palmerah")!
const sudirman = Stations.find("Stasiun Sudirman")!
const straightWalk = (from: Geo.Point, to: Geo.Point) => ({ meters: Math.round(Geo.inverse(from, to).meters * 1.25), seconds: 300 })

describe("walking from station access points", () => {
  test("entrances, the station building outline and platform ends become access points; the node is always kept", () => {
    const entrance = Geo.destination(palmerah, 0, 60)
    const outline = [Geo.destination(palmerah, 10, 55), Geo.destination(palmerah, 100, 40), Geo.destination(palmerah, 200, 40)]
    const points = MapsAccess.pointsOf(
      [
        { type: "node", id: 1, lat: entrance.latitude, lon: entrance.longitude, tags: { railway: "train_station_entrance" } },
        // A shop door 150 m away is not a station entrance.
        { type: "node", id: 2, ...latLon(Geo.destination(palmerah, 90, 150)), tags: { entrance: "yes" } },
        { type: "way", id: 3, tags: { building: "train_station" }, geometry: outline.map(latLon) },
        { type: "way", id: 4, tags: { railway: "platform" }, geometry: [Geo.destination(palmerah, 0, 100), Geo.destination(palmerah, 90, 5), Geo.destination(palmerah, 180, 100)].map(latLon) },
      ],
      [palmerah],
    ).get(palmerah.id)!
    expect(points.map((point) => point.kind)).toEqual(["entrance", "building", "building", "building", "platform", "platform", "node"])
    expect(points.at(-1)).toMatchObject({ latitude: palmerah.latitude, longitude: palmerah.longitude })
  })

  test("the shortest usable walk over the access points counts, and an odd snap only when nothing else routes", async () => {
    const office = Geo.destination(palmerah, 0, 305)
    const entrance = { ...Geo.destination(palmerah, 0, 50), kind: "entrance" as const }
    const node = { latitude: palmerah.latitude, longitude: palmerah.longitude, kind: "node" as const }
    const [walk] = await Effect.runPromise(
      MapsAccess.fromStations([{ station: palmerah, to: office }], {
        points: new Map([[palmerah.id, [entrance, node]]]),
        // The node snaps across the tracks (2859 m, the Kompas Gramedia case); the entrance walks straight out.
        walking: (pairs) =>
          Effect.succeed(pairs.map((pair) => (pair.from.latitude === node.latitude ? { meters: 2859, seconds: 2290 } : straightWalk(pair.from, pair.to)))),
      }),
    )
    expect(walk).toMatchObject({ from: "entrance", straight: 255 })
    expect(walk!.meters).toBeLessThan(400)
    expect(walk!.note).toBeUndefined()
    const [odd] = await Effect.runPromise(
      MapsAccess.fromStations([{ station: palmerah, to: office }], {
        points: new Map([[palmerah.id, [node]]]),
        walking: (pairs) => Effect.succeed(pairs.map(() => ({ meters: 2859, seconds: 2290 }))),
      }),
    )
    expect(odd!.note).toContain("snapped far away")
  })
})

describe("one transit ride", () => {
  test("route relations become routes with their stop coordinates and names", () => {
    const routes = MapsRide.parseRoutes([
      { type: "relation", id: 17241279, tags: { route: "bus", network: "Transjakarta", ref: "1B", name: "Transjakarta 1B: Stasiun Palmerah → Transport Hub Dukuh Atas" }, members: [{ type: "node", ref: 1, role: "platform" }, { type: "way", ref: 9, role: "" }, { type: "node", ref: 2, role: "stop" }] },
      { type: "relation", id: 5, tags: { route: "bus" }, members: [{ type: "node", ref: 1, role: "platform" }] },
      { type: "node", id: 1, lat: -6.2, lon: 106.8, tags: { name: "Stasiun Palmerah", highway: "bus_stop" } },
      { type: "node", id: 2, lat: -6.21, lon: 106.81 },
    ])
    expect(routes).toEqual([
      {
        id: "osm:relation/17241279",
        ref: "1B",
        name: "Transjakarta 1B: Stasiun Palmerah → Transport Hub Dukuh Atas",
        network: "Transjakarta",
        mode: "bus",
        stops: [
          { id: "osm:node/1", latitude: -6.2, longitude: 106.8, name: "Stasiun Palmerah" },
          { id: "osm:node/2", latitude: -6.21, longitude: 106.81 },
        ],
      },
    ])
  })

  test("one route stopping near the station and near the office connects them; walks are checked at both ends", async () => {
    const office = Geo.destination(sudirman, 90, 3000)
    const route: MapsRide.Route = {
      id: "osm:relation/1",
      ref: "JAK.11",
      network: "Mikrotrans",
      mode: "bus",
      stops: [
        { id: "osm:node/10", name: "Halte Stasiun Sudirman", ...Geo.destination(sudirman, 0, 150) },
        { id: "osm:node/11", name: "Halte Tengah", ...Geo.destination(sudirman, 90, 1500) },
        { id: "osm:node/12", name: "Halte Kantor", ...Geo.destination(office, 0, 200) },
      ],
    }
    const far: MapsRide.Route = { ...route, id: "osm:relation/2", ref: "X", stops: [route.stops[0]!, { id: "osm:node/20", ...Geo.destination(office, 0, 2000) }] }
    const rides = await Effect.runPromise(
      MapsRide.oneRide({
        stations: [sudirman],
        routes: [route, far],
        targets: [{ key: "office", point: office }, { key: "nowhere", point: Geo.destination(sudirman, 180, 9000) }],
        stationWalk: (pairs) => Effect.succeed(pairs.map((pair) => ({ ...straightWalk(pair.station, pair.to), straight: 150 }))),
        walking: (pairs) => Effect.succeed(pairs.map((pair) => straightWalk(pair.from, pair.to))),
      }),
    )
    expect([...rides.keys()]).toEqual(["office"])
    const ride = rides.get("office")!
    expect(ride).toMatchObject({ route: { ref: "JAK.11" }, board: { name: "Halte Stasiun Sudirman" }, alight: { name: "Halte Kantor" }, boardWalk: { meters: 188, approximate: false }, alightWalk: { meters: 250, approximate: false } })
    expect(MapsRide.rideText(ride)).toBe("1x Mikrotrans JAK.11 dari Stasiun Sudirman (naik Halte Stasiun Sudirman, turun Halte Kantor; jalan 188 m + 250 m)")
  })

  test("the ride is asked in words; walking only stays the default", () => {
    expect(extractConstraints(`${OWNER} atau 1x naik transum langsung dari stasiun`).accessMode).toBe("walk_or_one_transit")
    expect(extractConstraints("loker data analyst dekat KRL, sekali naik TransJakarta dari stasiun").accessMode).toBe("walk_or_one_transit")
    expect(extractConstraints("loker data analyst dekat KRL atau naik angkot dari stasiun").accessMode).toBe("walk_or_one_transit")
    expect(extractConstraints(OWNER).accessMode).toBeUndefined()
    expect(extractConstraints(`${OWNER} atau 1x naik transum langsung dari stasiun`).transitWalkKm).toBe(1)
  })
})

describe("research_deep access rules", () => {
  const listing = (company: string, title = "Data Analyst"): JobBoards.Listing => ({
    id: company,
    title,
    company,
    location: "Jakarta Pusat",
    url: `https://jobs.test/${company}`,
    board: "kalibrr",
  })
  const offices: Record<string, Geo.Point> = {
    "PT Gate": Geo.destination(sudirman, 0, 600),
    "PT Guess": Geo.destination(sudirman, 90, 650),
    "PT Beyond": Geo.destination(sudirman, 180, 850),
    "PT Bus": Geo.destination(sudirman, 90, 3000),
  }
  const route: MapsRide.Route = {
    id: "osm:relation/1",
    ref: "1B",
    network: "Transjakarta",
    mode: "bus",
    stops: [
      { id: "osm:node/10", name: "Stasiun Sudirman", ...Geo.destination(sudirman, 0, 120) },
      { id: "osm:node/12", name: "Halte Kantor", ...Geo.destination(offices["PT Bus"]!, 0, 200) },
    ],
  }
  const deps = (): Deps => ({
    searchPlaces: () => Effect.succeed({ provider: "openstreetmap", places: [] }),
    searchJobs: () => Effect.succeed({ results: [] }),
    scrape: () => Effect.succeed({ text: "", source: "none" }),
    board: (request) =>
      Effect.succeed({
        listings: request.kind === "browser" ? [] : Object.keys(offices).map((company) => listing(company)),
        reports: [{ board: "kalibrr", count: 4 }],
        manual: [],
      }),
    locateCompany: (request) =>
      Effect.succeed({ located: { name: request.name, ...offices[request.name]!, source: "osm-office" as const, confidence: "high" as const } }),
    nearTransit: (request) => Effect.succeed({ stations: Stations.list({ lines: request.lines }), features: [], total: 0 }),
    walking: (pairs) => Effect.succeed(pairs.map((pair) => straightWalk(pair.from, pair.to))),
    // PT Gate is reachable from an entrance; OSRM still snaps PT Guess and PT Beyond far away.
    stationWalking: (pairs) =>
      Effect.succeed(
        pairs.map((pair) => {
          const straight = Math.round(Geo.inverse(pair.station, pair.to).meters)
          const odd = Math.abs(straight - 650) < 5 || Math.abs(straight - 850) < 5
          return odd
            ? { meters: 3000, seconds: 2400, from: "node" as const, start: pair.station, straight, note: "routing snapped far away" }
            : { ...straightWalk(pair.station, pair.to), from: "entrance" as const, start: pair.station, straight }
        }),
      ),
    transitRoutes: () => Effect.succeed({ routes: [route], failed: [], errors: [] }),
  })

  test("walk mode: reachable on foot from the best entrance; an unusable route counts only within 0.7 × radius, as perkiraan", async () => {
    const out = await Effect.runPromise(runDeep(deps())({ query: OWNER, category: "job" }))
    const row = (company: string) => out.table?.split("\n").find((line) => line.includes(company))
    expect(row("PT Gate")).toContain("dari pintu masuk")
    expect(row("PT Gate")).toContain("| jalan kaki |")
    expect(row("PT Guess")).toContain("jalan kaki (perkiraan")
    expect(row("PT Beyond")).toBeUndefined()
    expect(out.outsideTable).toContain("PT Beyond")
    expect(out.outsideTable).toContain("PT Bus")
    expect(out.summary).toContain("(1 perkiraan)")
    expect(out.limitations.join(" ")).toContain("reachable on foot without paying")
  })

  test("one-ride mode adds the office one bus route away, with its route and stops", async () => {
    const out = await Effect.runPromise(runDeep(deps())({ query: `${OWNER} atau 1x naik transum langsung dari stasiun`, category: "job" }))
    const bus = out.table?.split("\n").find((line) => line.includes("PT Bus"))
    expect(bus).toContain("1x Transjakarta 1B dari Stasiun Sudirman (naik Stasiun Sudirman, turun Halte Kantor")
    expect(out.outsideTable).toContain("PT Beyond")
    expect(out.summary).toContain("1x naik transum langsung dari stasiun: 1")
    expect(out.candidates.find((candidate) => candidate.company === "PT Bus")?.travelMode).toBe("transit")
  })
})

function latLon(point: Geo.Point) {
  return { lat: point.latitude, lon: point.longitude }
}
