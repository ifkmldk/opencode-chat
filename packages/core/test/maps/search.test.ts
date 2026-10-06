import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { MapsSearch } from "../../src/maps/search.js"
import { Stations } from "../../src/maps/stations.js"

const hits: { path: string; body: string }[] = []
const tanahAbang = Stations.find("Tanah Abang")!

// Two hospitals near Tanah Abang, one mapped twice (a node and its building), and one unnamed.
const hospitals = [
  { type: "node", id: 11, lat: -6.18913, lon: 106.81046, tags: { amenity: "hospital", name: "RS Pelni" } },
  {
    type: "way",
    id: 12,
    center: { lat: -6.18921, lon: 106.81051 },
    tags: { amenity: "hospital", name: "RS PELNI", "addr:street": "Jalan Aipda K.S. Tubun" },
  },
  { type: "node", id: 13, lat: -6.19207, lon: 106.80123, tags: { healthcare: "hospital", name: "RSAB Harapan Kita" } },
  { type: "node", id: 14, lat: -6.1866, lon: 106.8113, tags: { amenity: "hospital" } },
]

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const body = request.method === "POST" ? (new URLSearchParams(await request.text()).get("data") ?? "") : ""
    hits.push({ path: url.pathname + url.search, body })
    if (url.pathname === "/interpreter") return Response.json({ elements: body.includes("hospital") ? hospitals : [] })
    if (url.pathname === "/api") return Response.json({ features: [] })
    if (url.pathname === "/search") return Response.json([])
    return Response.json({})
  },
})

beforeAll(() => {
  const base = `http://127.0.0.1:${server.port}`
  process.env.OPENCODE_MAPS_OVERPASS_URL = `${base}/interpreter`
  process.env.OPENCODE_MAPS_PHOTON_URL = base
  process.env.OPENCODE_MAPS_NOMINATIM_URL = base
  process.env.OPENCODE_MAPS_WIKI_URL = base
  process.env.OPENCODE_MAPS_NOMINATIM_INTERVAL_MS = "0"
  process.env.OPENCODE_MAPS_CACHE_DIR = "off"
})
afterAll(() => {
  for (const name of ["OVERPASS_URL", "PHOTON_URL", "NOMINATIM_URL", "WIKI_URL", "NOMINATIM_INTERVAL_MS", "CACHE_DIR"])
    delete process.env[`OPENCODE_MAPS_${name}`]
  server.stop(true)
})

describe("place search", () => {
  const maps = MapsSearch.make()

  test("a category near a station is an OSM tag search around the station, not free text", async () => {
    hits.length = 0
    const found = await Effect.runPromise(maps.places({ query: "rumah sakit", near: "Stasiun Tanah Abang", limit: 10 }))
    expect(found.category).toBe("hospital")
    expect(found.center).toMatchObject({ name: "Stasiun Tanah Abang", latitude: tanahAbang.latitude })
    expect(found.radiusMeters).toBe(3000)
    expect(hits.some((hit) => hit.path.startsWith("/search"))).toBe(false)
    const query = hits.find((hit) => hit.path === "/interpreter")!.body
    // The station is an OSM node, so Overpass searches around the node itself.
    expect(query).toContain(`node(id:${tanahAbang.id.replace("osm:node/", "")})->.centres;`)
    expect(query).toContain(
      'nwr["amenity"="hospital"](around.centres:3000);nwr["healthcare"="hospital"](around.centres:3000);',
    )
    // The node and the building of RS Pelni are one place; the unnamed hospital is reported, not listed.
    expect(found.places.map((place) => place.name)).toEqual(["RS Pelni", "RSAB Harapan Kita"])
    expect(found.places[0]).toMatchObject({ category: "Hospital", address: "Jalan Aipda K.S. Tubun" })
    expect(found.places[0]!.distanceM).toBeLessThan(found.places[1]!.distanceM!)
    expect(found.notice).toContain("1 unnamed hospital")
  })

  test("the place can be part of the query", async () => {
    const found = await Effect.runPromise(maps.places({ query: "RS dekat stasiun tanah abang", limit: 5 }))
    expect(found.center?.name).toBe("Stasiun Tanah Abang")
    expect(found.places.map((place) => place.name)).toContain("RSAB Harapan Kita")
  })

  test("a station is answered from the bundled list", async () => {
    hits.length = 0
    const found = await Effect.runPromise(maps.places({ query: "Stasiun Cisauk" }))
    expect(found.places[0]).toMatchObject({ name: "Stasiun Cisauk", id: Stations.find("Cisauk")!.id })
    expect(hits).toEqual([])
  })

  test("a centre that cannot be found is said, never silently dropped", async () => {
    const found = await Effect.runPromise(maps.places({ query: "hotel", anchor: "Kota Antah Berantah", radiusKm: 1 }))
    expect(found.notice).toContain('Could not locate "Kota Antah Berantah"')
    expect(found.notice).toContain("radius filter was not applied")
  })

  test("ids from earlier results and coordinates are reused without geocoding", async () => {
    hits.length = 0
    MapsSearch.remember([
      { id: "osm:way/562554943", name: "AEON Mall BSD City", latitude: -6.3046, longitude: 106.6436 },
    ])
    expect(await MapsSearch.locatePoint("place:osm:way/562554943")).toMatchObject({
      name: "AEON Mall BSD City",
      latitude: -6.3046,
    })
    expect(await MapsSearch.locatePoint("-6.2, 106.8")).toMatchObject({ latitude: -6.2, longitude: 106.8 })
    expect(await MapsSearch.locatePoint(tanahAbang.id)).toMatchObject({ name: "Stasiun Tanah Abang" })
    expect(await MapsSearch.locatePoint("Jurang Mangu")).toMatchObject({ name: "Stasiun Jurangmangu" })
    expect(hits).toEqual([])
  })
})
