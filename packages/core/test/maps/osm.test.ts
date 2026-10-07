import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Geo } from "../../src/maps/geo.js"
import { MapsOsm } from "../../src/maps/osm.js"
import { MapsLinks } from "../../src/maps/links.js"

const hits: { path: string; at: number; agent: string | null; body?: string }[] = []

// Fixture for the sort-then-truncate test: features east of a centre at 100 m steps, served in id order.
const centre = { latitude: -6.3, longitude: 106.65 }
const ladder = Array.from({ length: 12 }, (_, index) => ({
  type: "node",
  id: 100 - index,
  ...(() => {
    const point = Geo.destination(centre, 90, (12 - index) * 100)
    return { lat: point.latitude, lon: point.longitude }
  })(),
  tags: { amenity: "cafe", name: `Cafe ${(12 - index) * 100}` },
}))

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const body = request.method === "POST" ? await request.text() : undefined
    hits.push({ path: url.pathname + url.search, at: Date.now(), agent: request.headers.get("user-agent"), body })
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
    if (url.pathname === "/lookup")
      return Response.json([
        {
          lat: "-6.2",
          lon: "106.82",
          name: "Menara Astra",
          osm_type: "way",
          osm_id: 455441406,
          category: "building",
          type: "office",
        },
      ])
    if (url.pathname === "/api") {
      if (url.searchParams.get("q") !== "BSD") return Response.json({ features: [] })
      return Response.json({
        features: [
          {
            geometry: { coordinates: [106.668, -6.282] },
            properties: { name: "BSD", osm_key: "historic", osm_value: "castle", osm_type: "N", osm_id: 1 },
          },
          {
            geometry: { coordinates: [106.643, -6.3018] },
            properties: {
              name: "BSD City",
              osm_key: "place",
              osm_value: "suburb",
              osm_type: "R",
              osm_id: 2,
              city: "Tangerang Selatan",
            },
          },
        ],
      })
    }
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
    if (url.pathname === "/busy") return new Response("busy", { status: 504 })
    if (url.pathname === "/timeout")
      return Response.json({
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.',
      })
    if (url.pathname === "/ladder") {
      // Like Overpass: everything within the radius, cut at the output limit in id order, with the full count.
      const query = new URLSearchParams(body).get("data") ?? ""
      const radius = Number(query.match(/around:([\d.]+),/)?.[1])
      const limit = Number(query.match(/out center tags (\d+)/)?.[1] ?? 1e9)
      const inside = ladder
        .filter((item) => Geo.inverse(centre, { latitude: item.lat, longitude: item.lon }).meters <= radius)
        .toSorted((a, b) => a.id - b.id)
      // Pretend that more than the fetch cap exists beyond 800 m so the tighter second search is needed.
      const total = radius > 800 ? 100_000 : inside.length
      return Response.json({
        elements: [{ type: "count", id: 0, tags: { total: String(total) } }, ...inside.slice(0, limit)],
      })
    }
    return new Response("not found", { status: 404 })
  },
})
const base = `http://127.0.0.1:${server.port}`

beforeAll(() => {
  process.env.OPENCODE_MAPS_NOMINATIM_URL = base
  process.env.OPENCODE_MAPS_PHOTON_URL = base
  process.env.OPENCODE_MAPS_OSRM_URL = base
  process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/interpreter`
  process.env.OPENCODE_MAPS_NOMINATIM_INTERVAL_MS = "150"
  process.env.OPENCODE_MAPS_CACHE_DIR = "off"
})
afterAll(() => {
  for (const name of [
    "NOMINATIM_URL",
    "PHOTON_URL",
    "OSRM_URL",
    "OVERPASS_URL",
    "NOMINATIM_INTERVAL_MS",
    "CACHE_DIR",
    "COUNTRYCODES",
  ])
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

  test("Nominatim stays in Indonesia, and a category word near a place is bounded to that area", async () => {
    const near = { latitude: -6.1857, longitude: 106.8109 }
    await MapsOsm.search("rumah sakit", { near })
    const category = new URL(base + hits.at(-1)!.path).searchParams
    expect(category.get("countrycodes")).toBe("id")
    expect(category.get("bounded")).toBe("1")
    expect(category.get("viewbox")).toBeDefined()
    await MapsOsm.search("Menara Astra", { near })
    expect(new URL(base + hits.at(-1)!.path).searchParams.get("bounded")).toBeNull()
    process.env.OPENCODE_MAPS_COUNTRYCODES = ""
    await MapsOsm.search("Menara Astra")
    expect(new URL(base + hits.at(-1)!.path).searchParams.get("countrycodes")).toBeNull()
    delete process.env.OPENCODE_MAPS_COUNTRYCODES
  })

  test("streets and areas are searched in every layer first, names in the POI layer", async () => {
    hits.length = 0
    await MapsOsm.search("Jl. Pahlawan Seribu, Serpong")
    expect(new URL(base + hits.at(-1)!.path).searchParams.get("layer")).toBeNull()
    await MapsOsm.search("Teras Kota BSD")
    expect(new URL(base + hits.at(-1)!.path).searchParams.get("layer")).toBe("poi,railway,natural,manmade")
    expect(MapsOsm.looksLikeAddress("Kecamatan Serpong")).toBe(true)
    expect(MapsOsm.looksLikeAddress("Jakarta Selatan")).toBe(true)
    expect(MapsOsm.looksLikeAddress("AEON Mall BSD City")).toBe(false)
  })

  test("geocode reads coordinates directly and falls back from Photon to Nominatim", async () => {
    expect(await MapsOsm.geocode("-6.2, 106.8")).toMatchObject({ latitude: -6.2, longitude: 106.8 })
    expect(await MapsOsm.geocode("AEON Mall BSD")).toMatchObject({ name: "AEON Mall BSD City", latitude: -6.3016 })
  })

  test("geocode keeps Photon inside Indonesia, biased to Jakarta, and prefers the area for a short area name", async () => {
    const found = await MapsOsm.geocode("BSD")
    expect(found).toMatchObject({ name: "BSD City", id: "osm:relation/2", category: "suburb" })
    const photon = new URL(base + hits.findLast((hit) => hit.path.startsWith("/api"))!.path).searchParams
    expect(photon.get("bbox")).toBe("94.7,-11.2,141.1,6.3")
    expect(photon.get("lat")).toBe("-6.2")
  })

  test("an OSM id is looked up directly", async () => {
    expect(await MapsOsm.lookup("osm:way/455441406")).toMatchObject({ name: "Menara Astra", latitude: -6.2 })
    expect(hits.at(-1)!.path).toContain("osm_ids=W455441406")
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

  test("nearest N are the truly nearest: a capped answer is searched again over a radius that holds them all", async () => {
    process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/ladder`
    const found = await MapsOsm.features({
      selectors: ["amenity=cafe"],
      centers: [centre],
      radiusMeters: 5000,
      limit: 3,
    })
    process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/interpreter`
    expect(found.items.map((item) => item.name)).toEqual(["Cafe 100", "Cafe 200", "Cafe 300"])
    expect(found.items.map((item) => item.meters)).toEqual([100, 200, 300])
    expect(found.total).toBe(100_000)
    expect(found.capped).toBe(false)
  })

  test("a busy or timed-out mirror hands over to the next, which is then tried first", async () => {
    process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/busy,${base}/timeout,${base}/interpreter`
    hits.length = 0
    const first = await MapsOsm.features({ selectors: ["amenity=hospital"], bbox: MapsOsm.JABODETABEK })
    expect(first.items.map((item) => item.id)).toContain("osm:node/1")
    expect(hits.map((hit) => hit.path)).toEqual(["/busy", "/timeout", "/interpreter"])
    hits.length = 0
    await MapsOsm.features({ selectors: ["amenity=clinic"], bbox: MapsOsm.JABODETABEK })
    expect(hits.map((hit) => hit.path)).toEqual(["/interpreter"])
    process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/busy`
    await expect(MapsOsm.features({ selectors: ["amenity=school"], bbox: MapsOsm.JABODETABEK })).rejects.toThrow(
      "Overpass did not answer",
    )
    process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/interpreter`
  })

  test("Overpass answers are cached", async () => {
    hits.length = 0
    await MapsOsm.features({ selectors: ["amenity=bank"], bbox: MapsOsm.JABODETABEK })
    await MapsOsm.features({ selectors: ["amenity=bank"], bbox: MapsOsm.JABODETABEK })
    expect(hits.filter((hit) => hit.path === "/interpreter")).toHaveLength(1)
  })
})

describe("Overpass query builder", () => {
  test("selectors: key only, value, alternatives, and AND with +", () => {
    expect(MapsOsm.filter("office")).toBe('["office"]')
    expect(MapsOsm.filter("tourism=hotel")).toBe('["tourism"="hotel"]')
    expect(MapsOsm.filter("tourism=hotel|guest_house")).toBe('["tourism"~"^(hotel|guest_house)$"]')
    expect(MapsOsm.filter("railway=station+network=KAI Commuter")).toBe(
      '["railway"="station"]["network"="KAI Commuter"]',
    )
  })

  test("selectors that could break out of the query are refused", () => {
    expect(MapsOsm.filter('amenity"];out;')).toBeUndefined()
    expect(MapsOsm.filter('name=a"b')).toBeUndefined()
    expect(MapsOsm.filter("name=a\\b")).toBeUndefined()
    expect(MapsOsm.filter("tourism=hotel|.*")).toBeUndefined()
    expect(MapsOsm.filter("=hotel")).toBeUndefined()
    expect(() => MapsOsm.overpassQuery({ selectors: ["office", 'x"]'], bbox: MapsOsm.JABODETABEK })).toThrow(
      "Not a valid OSM tag selector",
    )
  })

  test("several centres: one around per centre, or one node set when they are OSM nodes", () => {
    const union = MapsOsm.overpassQuery({
      selectors: ["amenity=hospital", "healthcare=hospital"],
      centers: [
        { latitude: -6.1857127, longitude: 106.8108938 },
        { latitude: -6.2024, longitude: 106.8234 },
      ],
      radiusMeters: 500,
    })
    expect(union).toBe(
      '[out:json][timeout:25];(nwr["amenity"="hospital"](around:500,-6.1857127,106.8108938);nwr["healthcare"="hospital"](around:500,-6.1857127,106.8108938);nwr["amenity"="hospital"](around:500,-6.2024,106.8234);nwr["healthcare"="hospital"](around:500,-6.2024,106.8234););out center tags;',
    )
    const set = MapsOsm.overpassQuery({
      selectors: ["office"],
      centers: [
        { id: "osm:node/4836555990", latitude: -6.18, longitude: 106.81 },
        { id: "osm:node/4925555833", latitude: -6.2, longitude: 106.82 },
      ],
      radiusMeters: 1000,
      timeout: 30,
    })
    expect(set).toBe(
      '[out:json][timeout:30];node(id:4836555990,4925555833)->.centres;(nwr["office"](around.centres:1000););out center tags;',
    )
  })

  test("a name becomes a case-insensitive regex of its words only", () => {
    expect(MapsOsm.namePattern("Kompas Gramedia")).toBe("kompas.{0,3}gramedia")
    const query = MapsOsm.overpassQuery({
      selectors: ["office"],
      name: 'Astra"];out body;(.*)',
      bbox: MapsOsm.JABODETABEK,
    })
    expect(query).toContain('[~"^(name|brand|operator)$"~"astra.{0,3}out.{0,3}body",i]')
    expect(query.match(/"/g)!.length % 2).toBe(0)
    expect(() => MapsOsm.overpassQuery({ selectors: [], name: "***", bbox: MapsOsm.JABODETABEK })).toThrow()
  })

  test("a limit asks for the total count too", () => {
    expect(
      MapsOsm.overpassQuery({
        selectors: ["amenity=cafe"],
        centers: [{ latitude: -6, longitude: 106 }],
        radiusMeters: 300,
        limit: 50,
      }),
    ).toBe(
      '[out:json][timeout:25];(nwr["amenity"="cafe"](around:300,-6,106);)->.found;.found out count;.found out center tags 50;',
    )
  })

  test("tags tell what a feature is and where it is", () => {
    const tags = {
      building: "office",
      office: "company",
      name: "X",
      "addr:street": "Jalan Sudirman",
      "addr:housenumber": "5",
      "addr:city": "Jakarta",
    }
    expect(MapsOsm.categoryOf(tags, ["office", "building=office|commercial"])).toBe("office=company")
    expect(MapsOsm.addressOf(tags)).toBe("Jalan Sudirman 5, Jakarta")
    expect(MapsOsm.matches(tags, "building=office|commercial")).toBe(true)
    expect(MapsOsm.matches(tags, "amenity=place_of_worship+religion=muslim")).toBe(false)
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
