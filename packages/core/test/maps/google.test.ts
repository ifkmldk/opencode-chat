import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { MapsGoogle } from "../../src/maps/google.js"
import { MapsError } from "../../src/maps/error.js"

const requests: { model: string; body: Record<string, unknown>; key: string | null }[] = []
const behaviour = { flash: 200 as number, lite: 200 as number }

const reply = (text: string, chunks: { title: string; uri: string; placeId?: string }[]) => ({
  candidates: [
    {
      content: { parts: [{ text }] },
      groundingMetadata: { groundingChunks: chunks.map((maps) => ({ maps })) },
    },
  ],
})

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const model = url.pathname.match(/models\/([^:]+):generateContent/)?.[1] ?? ""
    const body = (await request.json()) as Record<string, unknown>
    requests.push({ model, body, key: request.headers.get("x-goog-api-key") })
    if (model === "gemini-2.5-flash" && behaviour.flash === 404)
      return Response.json(
        { error: { message: `This model models/${model} is no longer available to new users.` } },
        { status: 404 },
      )
    if (model === "gemini-2.5-flash" && behaviour.flash !== 200)
      return Response.json({ error: { message: `quota exceeded for key secret-key-123` } }, { status: behaviour.flash })
    if (model === "gemini-2.5-flash-lite" && behaviour.lite === 404)
      return Response.json(
        { error: { message: `This model models/${model} is no longer available to new users.` } },
        { status: 404 },
      )
    const prompt = JSON.stringify(body)
    if (prompt.includes("landmark"))
      return Response.json(reply("Monas", [{ title: "Monumen Nasional", uri: "https://maps.google.com/?cid=1" }]))
    if (prompt.includes("Answer using Google Maps"))
      return Response.json(
        reply("Take the KRL Rangkasbitung line from Tanah Abang.", [
          { title: "Tanah Abang Station", uri: "https://maps.google.com/?cid=2" },
        ]),
      )
    return Response.json(
      reply(
        "Here you go:\n```json\n" +
          JSON.stringify([
            {
              name: "Urban Hotel Serpong",
              address: "Jl. Letnan Sutopo, BSD",
              rating: 4.6,
              ratingCount: 1289,
              category: "Hotel",
              priceLevel: "$$",
              openNow: true,
              hoursToday: "Open 24 hours",
              latitude: -6.3,
              longitude: 106.67,
              note: "Cheap and well rated",
            },
            { name: "Invented Hotel", rating: 5 },
            { name: "Sapphire Sky Hotel", rating: 9, priceLevel: "cheap", latitude: 200 },
          ]) +
          "\n```",
        [
          { title: "Urban Hotel Serpong", uri: "https://maps.google.com/?cid=10", placeId: "places/ChIJurban" },
          {
            title: "Sapphire Sky Hotel & Conference",
            uri: "https://maps.google.com/?cid=11",
            placeId: "places/ChIJsapphire",
          },
        ],
      ),
    )
  },
})

beforeAll(() => {
  process.env.OPENCODE_MAPS_GEMINI_URL = `http://127.0.0.1:${server.port}`
})
afterAll(() => {
  delete process.env.OPENCODE_MAPS_GEMINI_URL
  server.stop(true)
})

describe("Google Maps grounding via Gemini", () => {
  test("sends the Maps grounding tool, the location bias and the key header", async () => {
    requests.length = 0
    await MapsGoogle.places("secret-key-123", {
      query: "hotel BSD",
      near: { latitude: -6.3, longitude: 106.66 },
      limit: 5,
    })
    expect(requests[0]!.model).toBe("gemini-2.5-flash")
    expect(requests[0]!.key).toBe("secret-key-123")
    expect(requests[0]!.body.tools).toEqual([{ googleMaps: {} }])
    expect(requests[0]!.body.toolConfig).toEqual({ retrievalConfig: { latLng: { latitude: -6.3, longitude: 106.66 } } })
  })

  test("keeps only places backed by a Google Maps source and cleans invalid values", async () => {
    const result = await MapsGoogle.places("k", { query: "hotel BSD", limit: 5 })
    expect(result.places.map((place) => place.name)).toEqual(["Urban Hotel Serpong", "Sapphire Sky Hotel"])
    const [urban, sapphire] = result.places
    expect(urban).toMatchObject({
      id: "ChIJurban",
      placeId: "ChIJurban",
      rating: 4.6,
      ratingCount: 1289,
      priceLevel: "$$",
      googleMapsUri: "https://maps.google.com/?cid=10",
    })
    // Out-of-range rating, bad price level and impossible latitude are dropped rather than trusted.
    expect(sapphire!.rating).toBeUndefined()
    expect(sapphire!.priceLevel).toBeUndefined()
    expect(sapphire!.latitude).toBeUndefined()
  })

  test("falls back to Flash-Lite when Flash is rate limited, and never leaks the key", async () => {
    behaviour.flash = 429
    requests.length = 0
    const result = await MapsGoogle.ask("secret-key-123", { question: "KRL to Karawaci?" })
    expect(requests.map((request) => request.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"])
    expect(result).toMatchObject({ model: "gemini-2.5-flash-lite", sources: [{ title: "Tanah Abang Station" }] })
    behaviour.flash = 403
    const error = await MapsGoogle.test("secret-key-123").catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(MapsError)
    expect((error as MapsError).kind).toBe("rejected")
    expect((error as MapsError).message).not.toContain("secret-key-123")
    behaviour.flash = 200
  })

  test("parses bare, fenced and prose-wrapped JSON", () => {
    expect(MapsGoogle.parseItems('[{"name":"A"}]')).toHaveLength(1)
    expect(MapsGoogle.parseItems('Sure! ```json\n[{"name":"A","rating":4.5}]\n``` done')).toMatchObject([
      { name: "A", rating: 4.5 },
    ])
    expect(MapsGoogle.parseItems("no json here")).toEqual([])
    expect(MapsGoogle.parseItems('[{"nama":"missing name"}]')).toEqual([])
  })

  test("matches names across punctuation, diacritics and extra words", () => {
    const same = (a: string, b: string) => MapsGoogle.similar(MapsGoogle.normalize(a), MapsGoogle.normalize(b))
    expect(same("ÆON Mall BSD City", "AEON Mall BSD City")).toBe(true)
    expect(same("Sapphire Sky Hotel", "Sapphire Sky Hotel & Conference")).toBe(true)
    expect(same("Urban Hotel Serpong", "Starlet Hotel BSD")).toBe(false)
  })
})

// fork: Google retires free models for new keys with a 404; the next free model is used, and when none is left the
// error says so (Gemini 3 has Maps grounding on the paid tier only, so it is never tried).
describe("retired free models", () => {
  test("a retired Flash falls through to Flash-Lite and is skipped afterwards", async () => {
    MapsGoogle.__test.reset()
    behaviour.flash = 404
    requests.length = 0
    expect((await MapsGoogle.test("secret-key-123")).model).toBe("gemini-2.5-flash-lite")
    await MapsGoogle.test("secret-key-123")
    expect(requests.map((request) => request.model)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash-lite",
    ])
    behaviour.flash = 200
    MapsGoogle.__test.reset()
  })

  test("when every free model is retired the error names the paid-only situation", async () => {
    MapsGoogle.__test.reset()
    behaviour.flash = 404
    behaviour.lite = 404
    const error = await MapsGoogle.test("secret-key-123").catch((value: unknown) => value)
    expect(error).toBeInstanceOf(MapsError)
    expect((error as MapsError).kind).toBe("disabled")
    expect((error as MapsError).message).toContain("paid tier only")
    behaviour.flash = 200
    behaviour.lite = 200
    MapsGoogle.__test.reset()
  })
})
