import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { MapsCategory } from "../src/maps/categories.js"
import { Geo } from "../src/maps/geo.js"
import { MapsOsm } from "../src/maps/osm.js"
import { Stations } from "../src/maps/stations.js"
import { MapsTransit } from "../src/maps/transit-buffer.js"

// Real OSM objects (2026-10) near KRL Palmerah, Sudirman and far away in Bogor.
const kompas: MapsOsm.Element = {
  id: "osm:way/155110242",
  name: "Kompas Gramedia",
  latitude: -6.2083655,
  longitude: 106.794511,
  tags: {
    building: "company",
    name: "Kompas Gramedia",
    "addr:street": "Jalan Palmerah Barat",
    "addr:housenumber": "29-32",
  },
  url: "https://www.openstreetmap.org/way/155110242",
}
const astra: MapsOsm.Element = {
  id: "osm:way/455441406",
  name: "Menara Astra",
  latitude: -6.2071506,
  longitude: 106.8211303,
  tags: { building: "office", name: "Menara Astra", website: "astra.co.id" },
  url: "https://www.openstreetmap.org/way/455441406",
}
const unnamed: MapsOsm.Element = {
  id: "osm:way/1",
  latitude: -6.2035,
  longitude: 106.8236,
  tags: { building: "commercial" },
  url: "https://www.openstreetmap.org/way/1",
}
const bogor: MapsOsm.Element = {
  id: "osm:node/2",
  name: "Kantor Jauh",
  latitude: -6.62,
  longitude: 106.8,
  tags: { office: "company", name: "Kantor Jauh" },
  url: "https://www.openstreetmap.org/node/2",
}

describe("nearest station per feature", () => {
  test("features get their nearest requested station, the radius filters, duplicates go, nearest first", () => {
    const features = MapsTransit.assign(
      [astra, kompas, unnamed, bogor, kompas],
      Stations.list(),
      MapsCategory.tags("office"),
      1000,
    )
    expect(features.map((item) => [item.id, item.nearest.station])).toEqual([
      ["osm:way/1", "Sudirman"],
      ["osm:way/155110242", "Palmerah"],
      ["osm:way/455441406", "Sudirman"],
    ])
    const palmerah = Stations.find("Palmerah")!
    expect(features[1]!.nearest).toEqual({
      stationId: palmerah.id,
      station: "Palmerah",
      lines: palmerah.lines,
      meters: Math.round(Geo.inverse(palmerah, kompas).meters),
    })
    expect(features[1]!.nearest.meters).toBeGreaterThan(250)
    expect(features[1]!.nearest.meters).toBeLessThan(400)
    expect(features[1]).toMatchObject({ category: "building=company", address: "Jalan Palmerah Barat 29-32" })
    expect(features[2]).toMatchObject({ category: "building=office", website: "https://astra.co.id" })
  })

  test("restricted to one line, the nearest station is on that line", () => {
    const [feature] = MapsTransit.assign([astra], Stations.list({ lines: ["rangkasbitung"] }), ["building"], 5000)
    expect(feature!.nearest.lines).toContain("rangkasbitung")
    expect(feature!.nearest.station).not.toBe("Sudirman")
  })

  test("the fast shortlist agrees with an exact search over every station", () => {
    const stations = Stations.list({ modes: ["krl", "mrt", "lrt"] })
    const points = Array.from({ length: 40 }, (_, index) => ({
      latitude: -6.1 - index * 0.012,
      longitude: 106.6 + index * 0.011,
    }))
    points.forEach((point) => {
      const exact = Geo.nearest(point, stations, 1)[0]!
      const fast = Geo.nearestCentre(point, stations)!
      expect(fast.centre.id).toBe(exact.item.id)
      expect(fast.meters).toBeCloseTo(exact.meters, 6)
    })
  })

  test("websites are absolute URLs, and a walk far longer than the straight line is flagged", () => {
    expect(MapsTransit.websiteOf({ website: "https://www.kredivo.id/" })).toBe("https://www.kredivo.id/")
    expect(MapsTransit.websiteOf({ "contact:website": "cermati.com" })).toBe("https://cermati.com")
    expect(MapsTransit.websiteOf({ website: "not a site" })).toBeUndefined()
    expect(MapsTransit.walkingNote(303, { meters: 2433, seconds: 1750 })).toContain("snapped far away")
    expect(MapsTransit.walkingNote(579, { meters: 786, seconds: 600 })).toBeUndefined()
    expect(MapsTransit.walkingNote(100, undefined)).toBe("no walking route found")
  })
})

describe("Overpass and OSRM through local servers", () => {
  const requests: { path: string; body: string }[] = []
  // Fails every Overpass request that includes Tanah Abang, to test the retry and the notice.
  const failing = { station: "" }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "POST" ? (new URLSearchParams(await request.text()).get("data") ?? "") : ""
      requests.push({ path: url.pathname + url.search, body })
      if (url.pathname === "/interpreter") {
        if (failing.station && body.includes(failing.station)) return new Response("busy", { status: 504 })
        const ids = body.match(/node\(id:([\d,]+)\)/)?.[1]?.split(",") ?? []
        const elements = [kompas, astra, bogor]
          .filter((item) =>
            ids.some((id) => {
              const station = Stations.list().find((entry) => entry.id === `osm:node/${id}`)
              return station && Geo.inverse(station, item).meters <= 1000
            }),
          )
          .map((item) => {
            const [type, id] = item.id.replace("osm:", "").split("/")
            return { type, id: Number(id), center: { lat: item.latitude, lon: item.longitude }, tags: item.tags }
          })
        return Response.json({ elements })
      }
      if (url.pathname.includes("/table/v1/")) {
        // Walking is 1.3x the straight line at 1.4 m/s; the last destination is unreachable.
        const points = url.pathname
          .split("/")
          .at(-1)!
          .split(";")
          .map((pair) => {
            const [longitude, latitude] = pair.split(",").map(Number)
            return { latitude: latitude!, longitude: longitude! }
          })
        const sources = url.searchParams.get("sources")!.split(";").map(Number)
        const destinations = url.searchParams.get("destinations")!.split(";").map(Number)
        const distances = sources.map((source) =>
          destinations.map((destination, index) =>
            index === destinations.length - 1 && points[destination]!.latitude === 0
              ? null
              : Geo.inverse(points[source]!, points[destination]!).meters * 1.3,
          ),
        )
        return Response.json({
          distances,
          durations: distances.map((row) => row.map((cell) => (cell === null ? null : cell / 1.4))),
        })
      }
      return new Response("not found", { status: 404 })
    },
  })

  beforeAll(() => {
    process.env.OPENCODE_MAPS_OVERPASS_URL = `http://127.0.0.1:${server.port}/interpreter`
    process.env.OPENCODE_MAPS_OSRM_URL = `http://127.0.0.1:${server.port}`
    process.env.OPENCODE_MAPS_CACHE_DIR = "off"
  })
  afterAll(() => {
    for (const name of ["OVERPASS_URL", "OSRM_URL", "CACHE_DIR"]) delete process.env[`OPENCODE_MAPS_${name}`]
    server.stop(true)
  })

  test("every KRL station is searched in a few node-set requests and features come back with their station", async () => {
    requests.length = 0
    const found = await Effect.runPromise(MapsTransit.nearStations({ kind: "office", radiusMeters: 1000 }))
    const overpass = requests.filter((entry) => entry.path === "/interpreter")
    expect(found.stations).toHaveLength(Stations.list().length)
    expect(overpass).toHaveLength(Math.ceil(Stations.list().length / 20))
    expect(overpass.every((entry) => entry.body.includes("(around.centres:1000)"))).toBe(true)
    expect(overpass[0]!.body).toContain(
      'nwr["office"](around.centres:1000);nwr["building"~"^(office|commercial|company)$"](around.centres:1000);',
    )
    expect(found.features.map((item) => [item.name, item.nearest.station])).toEqual([
      ["Kompas Gramedia", "Palmerah"],
      ["Menara Astra", "Sudirman"],
    ])
    expect(found.total).toBe(2)
    expect(found.notice).toBeUndefined()
  })

  test("lines and station names narrow the search; unknown ones are explained", async () => {
    const line = await Effect.runPromise(
      MapsTransit.nearStations({ lines: ["Rangkas Bitung"], radiusMeters: 1000, tags: ["building"] }),
    )
    expect(line.stations.every((station) => station.lines.includes("rangkasbitung"))).toBe(true)
    expect(line.features.map((item) => item.name)).toEqual(["Kompas Gramedia"])
    const named = await Effect.runPromise(
      MapsTransit.nearStations({ stations: ["Stasiun Sudirman", "Atlantis"], radiusMeters: 1000, kind: "office" }),
    )
    expect(named.stations.map((station) => station.name)).toEqual(["Sudirman"])
    expect(named.notice).toContain("Unknown stations skipped: Atlantis")
    const wrong = await Effect.runPromise(
      Effect.flip(MapsTransit.nearStations({ lines: ["hogwarts"], radiusMeters: 1000 })),
    )
    expect(wrong.message).toContain("Unknown line")
    expect(wrong.message).toContain("rangkasbitung")
  })

  test("a failing group is retried in halves; what still fails is named in the notice", async () => {
    failing.station = Stations.find("Tanah Abang")!.id.replace("osm:node/", "")
    // A radius not used before, so the answer is not already in the Overpass cache.
    const found = await Effect.runPromise(MapsTransit.nearStations({ kind: "office", radiusMeters: 900 }))
    failing.station = ""
    expect(found.notice).toContain("Tanah Abang")
    expect(found.notice).toContain("Overpass failed for")
    expect(found.features.map((item) => item.name)).toContain("Kompas Gramedia")
  }, 30_000)

  test("walking distances are batched at 50 origins per table and keep the input order", async () => {
    requests.length = 0
    const station = Stations.find("Sudirman")!
    const pairs = Array.from({ length: 120 }, (_, index) => ({
      from: station,
      to: { latitude: -6.2 - index * 0.0001, longitude: 106.82 },
    }))
    const walks = await Effect.runPromise(MapsTransit.walking(pairs.map((pair) => ({ from: pair.to, to: pair.from }))))
    expect(requests.filter((entry) => entry.path.includes("/routed-foot/table/"))).toHaveLength(3)
    walks.forEach((walk, index) =>
      expect(walk!.meters).toBe(Math.round(Geo.inverse(pairs[index]!.to, station).meters * 1.3)),
    )
    const [unreachable] = await Effect.runPromise(
      MapsTransit.walking([{ from: station, to: { latitude: 0, longitude: 0 } }]),
    )
    expect(unreachable).toBeUndefined()
  })
})

describe("empty station scope", () => {
  test("a line and mode filter that leaves no station fails with a typed error", async () => {
    const exit = await Effect.runPromise(
      MapsTransit.nearStations({ lines: ["mrt-jakarta"], modes: ["krl"], radiusMeters: 500 }).pipe(Effect.flip),
    )
    expect(exit.kind).toBe("not_found")
  })
})
