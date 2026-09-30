import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { MapsOsm } from "../../src/maps/osm.js"
import { MapsLinks } from "../../src/maps/links.js"

const hits: { path: string; at: number; agent: string | null; body?: string }[] = []

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    hits.push({
      path: url.pathname + url.search,
      at: Date.now(),
      agent: request.headers.get("user-agent"),
      body: request.method === "POST" ? await request.text() : undefined,
    })
    if (url.pathname === "/search")
      return Response.json([
        {
          lat: "-6.3016",
          lon: "106.6531",
          name: "AEON Mall BSD City",
          display_name: "AEON Mall BSD City, Tangerang",
          osm_type: "way",
          osm_id: 123,
          category: "shop",
          type: "mall",
        },
      ])
    if (url.pathname === "/api") return Response.json({ features: [] })
    if (url.pathname.includes("/route/v1/"))
      return Response.json({
        routes: [
          {
            distance: 12_345.6,
            duration: 1_234.5,
            geometry: "abc",
            legs: [
              {
                distance: 12_345.6,
                duration: 1_234.5,
                summary: "Tol",
                steps: [{ name: "Jl. Tol", distance: 100.4, maneuver: { type: "turn", modifier: "left" } }],
              },
            ],
          },
        ],
      })
    if (url.pathname.includes("/trip/v1/"))
      return Response.json({
        waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }, { waypoint_index: 3 }],
      })
    if (url.pathname.includes("/table/v1/"))
      return Response.json({
        durations: [
          [0, 60.4],
          [61, null],
        ],
        distances: [
          [0, 500],
          [510, null],
        ],
      })
    if (url.pathname === "/interpreter")
      return Response.json({
        elements: [
          { type: "node", id: 1, lat: -6.3, lon: 106.65, tags: { amenity: "hospital", name: "RS A" } },
          { type: "way", id: 2, center: { lat: -6.35, lon: 106.7 }, tags: { shop: "convenience" } },
        ],
      })
    return new Response("not found", { status: 404 })
  },
})

beforeAll(() => {
  const base = `http://127.0.0.1:${server.port}`
  process.env.OPENCODE_MAPS_NOMINATIM_URL = base
  process.env.OPENCODE_MAPS_PHOTON_URL = base
  process.env.OPENCODE_MAPS_OSRM_URL = base
  process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/interpreter`
  process.env.OPENCODE_MAPS_NOMINATIM_INTERVAL_MS = "150"
})
afterAll(() => {
  for (const name of ["NOMINATIM_URL", "PHOTON_URL", "OSRM_URL", "OVERPASS_URL", "NOMINATIM_INTERVAL_MS"])
    delete process.env[`OPENCODE_MAPS_${name}`]
  server.stop(true)
})

describe("OpenStreetMap services", () => {
  test("search builds a real OSM link and identifies itself", async () => {
    const [place] = await MapsOsm.search("AEON Mall BSD")
    expect(place).toMatchObject({
      id: "osm:way/123",
      name: "AEON Mall BSD City",
      url: "https://www.openstreetmap.org/way/123",
      category: "shop/mall",
    })
    expect(hits.at(-1)!.agent).toContain("OpenCode")
  })

  test("Nominatim requests are spaced by the fair-use interval", async () => {
    hits.length = 0
    await Promise.all([MapsOsm.search("a"), MapsOsm.search("b"), MapsOsm.search("c")])
    const times = hits.filter((hit) => hit.path.startsWith("/search")).map((hit) => hit.at)
    expect(times).toHaveLength(3)
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(140)
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(140)
  })

  test("geocode reads coordinates directly and falls back from Photon to Nominatim", async () => {
    expect(await MapsOsm.geocode("-6.2, 106.8")).toMatchObject({ latitude: -6.2, longitude: 106.8 })
    expect(await MapsOsm.geocode("AEON Mall BSD")).toMatchObject({ name: "AEON Mall BSD City", latitude: -6.3016 })
  })

  test("routes use the per-profile FOSSGIS instance with the full polyline6 geometry", async () => {
    const route = await MapsOsm.route(
      [
        { latitude: -6.2, longitude: 106.8 },
        { latitude: -6.3, longitude: 106.65 },
      ],
      "foot",
    )
    expect(hits.at(-1)!.path).toContain("/routed-foot/route/v1/driving/106.8,-6.2;106.65,-6.3")
    expect(hits.at(-1)!.path).toContain("geometries=polyline6")
    expect(route).toMatchObject({
      distanceMeters: 12_345.6,
      geometry: "abc",
      legs: [{ steps: [{ instruction: "turn left", road: "Jl. Tol", distanceMeters: 100 }] }],
    })
  })

  test("trip returns the input indices in visiting order", async () => {
    const order = await MapsOsm.trip(
      [0, 1, 2, 3].map((index) => ({ latitude: -6 - index / 10, longitude: 106 })),
      "car",
    )
    expect(order).toEqual([0, 2, 1, 3])
  })

  test("table keeps unreachable cells as null", async () => {
    expect(
      await MapsOsm.table(
        [
          { latitude: 0, longitude: 0 },
          { latitude: 1, longitude: 1 },
        ],
        "car",
      ),
    ).toEqual({
      durations: [
        [0, 60.4],
        [61, null],
      ],
      distances: [
        [0, 500],
        [510, null],
      ],
    })
  })

  test("POI queries only accept real OSM tags and return distance-sorted features", async () => {
    await expect(
      MapsOsm.poi({
        center: { latitude: -6.3, longitude: 106.65 },
        radiusMeters: 1000,
        tags: ['amenity"];out;'],
        limit: 10,
      }),
    ).rejects.toThrow()
    const items = await MapsOsm.poi({
      center: { latitude: -6.3, longitude: 106.65 },
      radiusMeters: 5000,
      tags: ["amenity=hospital", "shop=convenience"],
      limit: 10,
    })
    expect(decodeURIComponent(hits.at(-1)!.body!)).toContain('nwr["amenity"="hospital"](around:5000,-6.3,106.65)')
    expect(items.map((item) => [item.id, item.tag])).toEqual([
      ["osm:node/1", "amenity=hospital"],
      ["osm:way/2", "shop=convenience"],
    ])
    expect(items[0]!.meters).toBe(0)
  })
})

describe("keyless Google Maps links", () => {
  test("place links carry the place id", () => {
    expect(MapsLinks.place({ name: "Urban Hotel Serpong", placeId: "ChIJurban" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Urban+Hotel+Serpong&query_place_id=ChIJurban",
    )
  })

  test("directions carry waypoints and the travel mode", () => {
    const url = new URL(
      MapsLinks.directions({
        origin: { name: "Tanah Abang" },
        destination: { name: "Karawaci", placeId: "ChIJk" },
        waypoints: [{ latitude: -6.2, longitude: 106.7 }, { name: "Serpong" }],
        mode: "transit",
      }),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      origin: "Tanah Abang",
      destination: "Karawaci",
      destination_place_id: "ChIJk",
      waypoints: "-6.2,106.7|Serpong",
      travelmode: "transit",
    })
  })
})
