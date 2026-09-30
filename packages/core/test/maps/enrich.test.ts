import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { MapsEnrich } from "../../src/maps/enrich.js"

// Local times: 2026-09-30 is a Wednesday.
const at = (hhmm: string, day = "2026-09-30") => new Date(`${day}T${hhmm}:00`)

describe("opening_hours", () => {
  test("24/7 and a simple daily span", () => {
    expect(MapsEnrich.openingHours("24/7", at("03:00"))).toEqual({ openNow: true, today: "24 hours" })
    expect(MapsEnrich.openingHours("10:00-22:00", at("21:59"))).toEqual({ openNow: true, today: "10:00–22:00" })
    expect(MapsEnrich.openingHours("10:00-22:00", at("22:00"))?.openNow).toBe(false)
  })

  test("weekday rules, several spans, and days off", () => {
    const hours = "Mo-Fr 08:00-12:00,13:00-17:00; Sa 09:00-13:00; Su off"
    expect(MapsEnrich.openingHours(hours, at("12:30"))).toEqual({ openNow: false, today: "08:00–12:00, 13:00–17:00" })
    expect(MapsEnrich.openingHours(hours, at("10:00", "2026-10-03"))).toEqual({ openNow: true, today: "09:00–13:00" })
    expect(MapsEnrich.openingHours(hours, at("10:00", "2026-10-04"))).toEqual({ openNow: false, today: "Closed today" })
  })

  test("spans past midnight count for the next morning", () => {
    expect(MapsEnrich.openingHours("Mo-Su 18:00-02:00", at("01:30"))?.openNow).toBe(true)
    expect(MapsEnrich.openingHours("Mo-Su 18:00-02:00", at("03:00"))?.openNow).toBe(false)
  })

  test("unsupported syntax gives no answer instead of a wrong one", () => {
    expect(MapsEnrich.openingHours("Jan-Mar Mo-Fr 08:00-12:00", at("10:00"))).toBeUndefined()
    expect(MapsEnrich.openingHours("sunrise-sunset", at("10:00"))).toBeUndefined()
  })

  test("details reads stars, contact and cuisine from tags", () => {
    expect(
      MapsEnrich.details({ stars: "4", phone: "+62 21 1", website: "https://x.id", cuisine: "indonesian;coffee_shop" }),
    ).toMatchObject({ stars: 4, phone: "+62 21 1", website: "https://x.id", cuisine: "indonesian, coffee shop" })
    expect(MapsEnrich.details({ stars: "9", website: "x.id" })).toMatchObject({ stars: undefined, website: undefined })
  })
})

describe("photos", () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/wiki/Special:EntityData/Q42.json")
        return Response.json({ entities: { Q42: { claims: { P18: [{ mainsnak: { datavalue: { value: "Aeon Mall BSD.jpg" } } }] } } } })
      if (url.pathname.startsWith("/api/rest_v1/page/summary/"))
        return Response.json({ thumbnail: { source: "https://upload.wikimedia.org/thumb/x.jpg" } })
      return new Response("", { status: 404 })
    },
  })
  beforeAll(() => {
    process.env.OPENCODE_MAPS_WIKI_URL = `http://127.0.0.1:${server.port}`
  })
  afterAll(() => {
    delete process.env.OPENCODE_MAPS_WIKI_URL
    server.stop()
  })

  test("Commons file tags need no request", async () => {
    const photo = await MapsEnrich.photo({ wikimedia_commons: "File:Grand Indonesia.jpg" })
    expect(photo?.url).toContain("Special:FilePath/Grand_Indonesia.jpg?width=480")
    expect(photo?.credit).toBe("Wikimedia Commons")
  })

  test("Wikidata P18 and Wikipedia thumbnails", async () => {
    expect((await MapsEnrich.photo({ wikidata: "Q42" }))?.url).toContain("Aeon_Mall_BSD.jpg")
    expect((await MapsEnrich.photo({ wikipedia: "id:AEON Mall BSD City" }))?.url).toBe("https://upload.wikimedia.org/thumb/x.jpg")
  })

  test("no link, no photo", async () => {
    expect(await MapsEnrich.photo({ name: "Warung" })).toBeUndefined()
    expect(await MapsEnrich.photo(undefined)).toBeUndefined()
  })
})
