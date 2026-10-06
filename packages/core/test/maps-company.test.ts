import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { MapsCompany } from "../src/maps/company.js"
import type { MapsOsm } from "../src/maps/osm.js"
import type { MapsTransit } from "../src/maps/transit-buffer.js"

// Real OSM objects (Overpass, 2026-10) that carry these company names in Jabodetabek.
const element = (id: string, latitude: number, longitude: number, tags: Record<string, string>): MapsOsm.Element => ({
  id,
  name: tags.name,
  latitude,
  longitude,
  tags,
  url: `https://www.openstreetmap.org/${id.replace("osm:", "")}`,
})
const astra = [
  element("osm:way/154892988", -6.1352806, 106.8855598, { landuse: "industrial", name: "Astra International" }),
  element("osm:way/154894838", -6.1359837, 106.8867274, {
    building: "yes",
    name: "Astra International",
    "addr:full": "Jalan Gaya Motor Raya",
  }),
  element("osm:node/6154795285", -6.1751028, 106.6262538, { shop: "motorcycle", name: "Daihatsu Astra International" }),
  element("osm:node/9935012718", -6.2071914, 106.8218849, {
    highway: "bus_stop",
    name: "Menara Astra",
    operator: "PT Transjakarta",
  }),
  element("osm:way/455441406", -6.2070842, 106.8211384, {
    building: "office",
    name: "Menara Astra",
    "addr:street": "Jalan Jend. Sudirman",
  }),
]
const bfi = [
  element("osm:node/14229589491", -6.3332407, 106.7096981, {
    office: "financial",
    amenity: "financial_advice",
    name: "BFI Finance",
    "addr:street": "Jalan Benda Raya",
  }),
  element("osm:way/398161774", -6.2944687, 106.665802, { building: "yes", name: "BFI Tower" }),
  element("osm:way/1430126878", -6.4951849, 106.7024462, {
    amenity: "place_of_worship",
    building: "yes",
    name: "Masjid MTBFI",
  }),
]
const kompas = [
  element("osm:way/121986303", -6.1540161, 106.8174174, { building: "yes", name: "Kompas Gramedia" }),
  element("osm:way/155110242", -6.2082299, 106.7945137, {
    building: "company",
    name: "Kompas Gramedia",
    "addr:street": "Jalan Palmerah Barat",
  }),
  element("osm:node/4240828681", -6.1947583, 106.7687183, { building: "commercial", name: "Kompas Gramedia Majalah" }),
]

describe("company names", () => {
  test.each([
    ["PT Astra International Tbk", "astra international"],
    ["PT. Bank Rakyat Indonesia (Persero) Tbk", "bank rakyat"],
    ["cermati.com", "cermati"],
    ["Kompas Gramedia Group", "kompas gramedia"],
    ["PT Traveloka Indonesia", "traveloka"],
    ["PT BFI Finance Indonesia Tbk", "bfi finance"],
    ["Bank Indonesia", "bank indonesia"],
    ["PT Telkom Indonesia (Persero) Tbk", "telkom"],
    ["Asuransi Indonesia Group", "asuransi indonesia group"],
  ])("%s → %s", (name, normalized) => {
    expect(MapsCompany.normalizeCompany(name)).toBe(normalized)
  })

  test("name scores: same company, head-office tower, dealer with extra words, unrelated", () => {
    expect(MapsCompany.nameScore("kredivo", "Kredivo Operations Office").score).toBe(1)
    expect(MapsCompany.nameScore("traveloka", "Traveloka Campus")).toMatchObject({ score: 1, tower: true })
    expect(MapsCompany.nameScore("astra international", "Menara Astra")).toMatchObject({ score: 0.9, brandOnly: true })
    expect(MapsCompany.nameScore("astra international", "Daihatsu Astra International").score).toBeCloseTo(0.7, 6)
    expect(MapsCompany.nameScore("bfi finance", "Masjid MTBFI").score).toBe(0)
    expect(MapsCompany.nameScore("bank central asia", "Menara Asia").score).toBeLessThan(0.5)
  })

  test("the head-office tower beats the old site, dealers and the bus stop named after it", () => {
    expect(MapsCompany.best("astra international", astra)?.element.id).toBe("osm:way/455441406")
    expect(MapsCompany.best("bfi finance", bfi)?.element.id).toBe("osm:way/398161774")
    expect(MapsCompany.best("kompas gramedia", kompas)?.element.id).toBe("osm:way/155110242")
    expect(MapsCompany.best("tokopedia", kompas)).toBeUndefined()
  })
})

describe("locating a company", () => {
  const paths: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      paths.push(url.pathname + url.search)
      const q = url.searchParams.get("q") ?? ""
      if (url.pathname === "/api" && q === "Sahid Sudirman Center")
        return Response.json({
          features: [
            {
              geometry: { coordinates: [106.8187, -6.2101] },
              properties: {
                name: "Sahid Sudirman Center",
                osm_key: "building",
                osm_value: "office",
                osm_type: "W",
                osm_id: 77,
                street: "Jalan Jenderal Sudirman",
              },
            },
          ],
        })
      if (url.pathname === "/api") return Response.json({ features: [] })
      if (url.pathname === "/search" && q.startsWith("Jl. Raya Serpong"))
        return Response.json([
          {
            lat: "-6.28",
            lon: "106.66",
            name: "Jalan Raya Serpong",
            display_name: "Jalan Raya Serpong, Serpong",
            osm_type: "way",
            osm_id: 5,
            category: "highway",
            type: "primary",
          },
        ])
      if (url.pathname === "/search") return Response.json([])
      return new Response("not found", { status: 404 })
    },
  })
  beforeAll(() => {
    const base = `http://127.0.0.1:${server.port}`
    process.env.OPENCODE_MAPS_PHOTON_URL = base
    process.env.OPENCODE_MAPS_NOMINATIM_URL = base
    process.env.OPENCODE_MAPS_NOMINATIM_INTERVAL_MS = "0"
    process.env.OPENCODE_MAPS_CACHE_DIR = "off"
    // The Google Maps page step renders google.com in the browser; never from tests.
    process.env.OPENCODE_MAPS_GOOGLE_PAGE = "0"
  })
  afterAll(() => {
    for (const name of ["PHOTON_URL", "NOMINATIM_URL", "NOMINATIM_INTERVAL_MS", "CACHE_DIR", "GOOGLE_PAGE"])
      delete process.env[`OPENCODE_MAPS_${name}`]
    server.stop(true)
  })

  const feature = (item: MapsOsm.Element): MapsTransit.Feature => ({
    ...item,
    category: "office=company",
    nearest: { stationId: "osm:node/1", station: "Palmerah", lines: ["rangkasbitung"], meters: 300 },
  })

  test("a match among the features near the stations needs no request, and is cached", async () => {
    paths.length = 0
    const office = element("osm:node/6210540393", -6.1769095, 106.8008235, { office: "company", name: "cermati.com" })
    const found = await Effect.runPromise(
      MapsCompany.locate({ name: "PT Cermati Indonesia", candidates: [feature(office)] }),
    )
    expect(found).toMatchObject({
      name: "cermati.com",
      source: "osm-office",
      confidence: "high",
      osmId: "osm:node/6210540393",
    })
    expect(paths).toEqual([])
    const again = await Effect.runPromise(MapsCompany.locate({ name: "Cermati" }))
    expect(again).toMatchObject({ source: "cache", latitude: -6.1769095 })
  })

  test("an office tower named in the address is used as the place", async () => {
    const found = await Effect.runPromise(
      MapsCompany.locate({
        name: "PT Contoh Analitika",
        address: "Sahid Sudirman Center Lt. 20, Jl. Jend. Sudirman Kav. 86",
      }),
    )
    expect(found).toMatchObject({
      name: "Sahid Sudirman Center",
      source: "osm-office",
      confidence: "medium",
      osmId: "osm:way/77",
    })
    expect(found?.note).toContain("office tower named in the listing address")
  })

  test("a street address is a low-confidence fallback, and nothing at all gives a reason", async () => {
    const street = await Effect.runPromise(
      MapsCompany.lookup({ name: "PT Tidak Terpetakan", address: "Jl. Raya Serpong No. 8, Lt. 3, Tangerang Selatan" }),
    )
    expect(street.located).toMatchObject({ source: "address", confidence: "low" })
    expect(
      paths.some(
        (path) => path.startsWith("/search") && path.includes("q=Jl.+Raya+Serpong+No.+8%2C+Tangerang+Selatan"),
      ),
    ).toBe(true)
    const missing = await Effect.runPromise(MapsCompany.lookup({ name: "PT Nama Fiktif Sekali" }))
    expect(missing.located).toBeUndefined()
    expect(missing.reason).toContain('no OSM office, building or brand named like "PT Nama Fiktif Sekali"')
    expect(missing.reason).toContain("no office address was given")
  })
})
