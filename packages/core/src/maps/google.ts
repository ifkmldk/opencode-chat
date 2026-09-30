export * as MapsGoogle from "./google.js"

import { Option, Schema } from "effect"
import type { Geo } from "./geo.js"
import { MapsError } from "./error.js"

// fork: Google Maps data through the Gemini API's "Grounding with Google Maps". Only the free tier of
// gemini-2.5-flash / -flash-lite includes it (500 grounded requests per day), and a free-tier project has no
// billing account, so these calls can never be charged. Google Maps Platform (Places/Routes) is deliberately
// not used: it always needs billing. https://ai.google.dev/gemini-api/docs/pricing

export const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] as const

export const __test = { reset: () => retired.clear() }

export type Source = { readonly title: string; readonly uri: string; readonly placeId?: string }

export type Place = {
  readonly id: string
  readonly name: string
  readonly address?: string
  readonly rating?: number
  readonly ratingCount?: number
  readonly category?: string
  readonly priceLevel?: string
  readonly openNow?: boolean
  readonly hoursToday?: string
  readonly note?: string
  readonly latitude?: number
  readonly longitude?: number
  readonly googleMapsUri: string
  readonly placeId?: string
}

const base = () => process.env.OPENCODE_MAPS_GEMINI_URL ?? "https://generativelanguage.googleapis.com"

/** Places for a query, keeping only entries that Gemini grounded on a Google Maps source. */
export async function places(
  key: string,
  input: { query: string; near?: Geo.Point; limit: number; openNow?: boolean },
) {
  const prompt = [
    "You are a data extraction assistant grounded in Google Maps.",
    `Find up to ${input.limit} real places that match: "${input.query}".`,
    input.near ? `Search near latitude ${input.near.latitude}, longitude ${input.near.longitude}.` : "",
    input.openNow ? "Only include places that are open now." : "",
    "Reply with ONLY a JSON array, no prose and no code fence. Each item has exactly these keys:",
    'name (the exact Google Maps name), address, rating (number or null), ratingCount (integer or null), category (short, e.g. "Hotel"),',
    'priceLevel ("$", "$$", "$$$", "$$$$" or null), openNow (true, false or null), hoursToday (for example "08:00-22:00", or null),',
    "latitude (number or null), longitude (number or null), note (at most 20 words on why it matches).",
    "Only include places present in Google Maps results. Never invent values; use null when unknown.",
  ]
    .filter(Boolean)
    .join("\n")
  const result = await generate(key, prompt, input.near)
  const sources = result.sources.map((source) => ({ source, key: normalize(source.title) }))
  const used = new Set<string>()
  const matched = parseItems(result.text).flatMap((item) => {
    const name = normalize(item.name)
    const match = sources.find((candidate) => !used.has(candidate.source.uri) && similar(name, candidate.key))
    if (!match) return []
    used.add(match.source.uri)
    const place: Place = {
      id: match.source.placeId ?? match.source.uri,
      name: item.name,
      address: item.address,
      rating: item.rating,
      ratingCount: item.ratingCount,
      category: item.category,
      priceLevel: item.priceLevel,
      openNow: item.openNow,
      hoursToday: item.hoursToday,
      note: item.note,
      latitude: item.latitude,
      longitude: item.longitude,
      googleMapsUri: match.source.uri,
      placeId: match.source.placeId,
    }
    return [place]
  })
  return { places: matched.slice(0, input.limit), model: result.model, sources: result.sources }
}

/** A grounded free-form answer (for example transit directions), with the Google Maps sources it used. */
export async function ask(key: string, input: { question: string; near?: Geo.Point }) {
  const prompt = [
    "Answer using Google Maps. Be concrete and practical: name the places, lines, stations, distances and times.",
    "If the question is about public transport, say which lines to take, where to transfer and the walking parts.",
    "Keep it under 250 words. Question:",
    input.question,
  ].join("\n")
  const result = await generate(key, prompt, input.near)
  return { answer: result.text.trim(), sources: result.sources, model: result.model }
}

/** One small grounded request, used by Settings → Maps → Test. */
export async function test(key: string) {
  const result = await generate(key, "Name one famous landmark in central Jakarta. Reply with just its name.", {
    latitude: -6.1754,
    longitude: 106.8272,
  })
  return { model: result.model, grounded: result.sources.length > 0, answer: result.text.trim().slice(0, 80) }
}

// Only the Gemini 2.5 models include Google Maps grounding in the free tier (500 requests/day); Gemini 3 lists it
// as paid-only. Google retires models for new keys with a 404, so a retired model is skipped for this process and
// the next one is tried.
const retired = new Set<string>()

async function generate(key: string, prompt: string, near?: Geo.Point) {
  const attempt = async (index: number): Promise<{ text: string; sources: Source[]; model: string }> => {
    const model = models[index]
    if (!model) throw noFreeModel()
    if (retired.has(model)) return attempt(index + 1)
    const outcome = await call(key, model, prompt, near).catch((error: unknown) => error)
    if (!(outcome instanceof MapsError)) return outcome as { text: string; sources: Source[]; model: string }
    if (outcome.kind === "not_found") retired.add(model)
    // The two models have separate free quotas, so a rate-limited Flash can still be served by Flash-Lite.
    if (outcome.kind === "not_found" || (outcome.kind === "rate_limited" && index + 1 < models.length))
      return attempt(index + 1)
    throw outcome
  }
  return attempt(0)
}

function noFreeModel() {
  return new MapsError({
    service: "gemini",
    kind: "disabled",
    message:
      "Google no longer offers a free Gemini model with Google Maps grounding for this key (Gemini 3 has it on the paid tier only), so OpenStreetMap is used.",
  })
}

async function call(key: string, model: string, prompt: string, near?: Geo.Point) {
  const response = await fetch(`${base()}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleMaps: {} }],
      ...(near
        ? { toolConfig: { retrievalConfig: { latLng: { latitude: near.latitude, longitude: near.longitude } } } }
        : {}),
      generationConfig: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch((cause) => {
    throw new MapsError({ service: "gemini", kind: "unavailable", message: "Gemini API is unreachable", cause })
  })
  const body = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    const message = typeof record(body.error).message === "string" ? String(record(body.error).message) : ""
    const retiredModel = response.status === 404 || /no longer available|not found for API version/i.test(message)
    const kind =
      response.status === 429
        ? "rate_limited"
        : retiredModel
          ? "not_found"
          : response.status >= 500
            ? "unavailable"
            : "rejected"
    throw new MapsError({
      service: "gemini",
      kind,
      message: `Gemini API HTTP ${response.status}${message ? `: ${redact(message, key).slice(0, 300)}` : ""}`,
    })
  }
  const candidate = record(Array.isArray(body.candidates) ? body.candidates[0] : undefined)
  const parts = record(candidate.content).parts
  const text = (Array.isArray(parts) ? parts : []).map((part) => String(record(part).text ?? "")).join("")
  const chunks = record(candidate.groundingMetadata).groundingChunks
  const sources = (Array.isArray(chunks) ? chunks : []).flatMap((chunk): Source[] => {
    const maps = record(record(chunk).maps)
    if (typeof maps.uri !== "string") return []
    return [
      {
        title: typeof maps.title === "string" ? maps.title : maps.uri,
        uri: maps.uri,
        placeId: typeof maps.placeId === "string" ? maps.placeId.replace(/^places\//, "") : undefined,
      },
    ]
  })
  return { text, sources, model }
}

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))
const Item = Schema.Struct({
  name: Schema.String,
  address: Nullable(Schema.String),
  rating: Nullable(Schema.Number),
  ratingCount: Nullable(Schema.Number),
  category: Nullable(Schema.String),
  priceLevel: Nullable(Schema.String),
  openNow: Nullable(Schema.Boolean),
  hoursToday: Nullable(Schema.String),
  latitude: Nullable(Schema.Number),
  longitude: Nullable(Schema.Number),
  note: Nullable(Schema.String),
})
const decodeItems = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeItem = Schema.decodeUnknownOption(Item)

/** The reply should be a bare JSON array, but models sometimes wrap it in prose or a code fence. */
export function parseItems(text: string) {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end <= start) return []
  const parsed = decodeItems(text.slice(start, end + 1))
  if (Option.isNone(parsed) || !Array.isArray(parsed.value)) return []
  return parsed.value.flatMap((raw) => {
    const item = decodeItem(raw)
    if (Option.isNone(item)) return []
    const value = item.value
    const number = (input: number | null | undefined, min: number, max: number) =>
      input !== null && input !== undefined && Number.isFinite(input) && input >= min && input <= max
        ? input
        : undefined
    const text = (input: string | null | undefined) => (input && input.trim() ? input.trim() : undefined)
    return [
      {
        name: value.name.trim(),
        address: text(value.address),
        rating: number(value.rating, 0, 5),
        ratingCount: number(value.ratingCount, 0, Number.MAX_SAFE_INTEGER),
        category: text(value.category),
        priceLevel: value.priceLevel && /^\${1,4}$/.test(value.priceLevel) ? value.priceLevel : undefined,
        openNow: value.openNow ?? undefined,
        hoursToday: text(value.hoursToday),
        latitude: number(value.latitude, -90, 90),
        longitude: number(value.longitude, -180, 180),
        note: text(value.note),
      },
    ]
  })
}

const LIGATURES: Record<string, string> = { æ: "ae", œ: "oe", ø: "o", ß: "ss", đ: "d", ł: "l" }

export function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[æœøßđł]/g, (letter) => LIGATURES[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Same place name: equal, one containing the other, or most words shared. */
export function similar(a: string, b: string) {
  if (!a || !b) return false
  if (a === b) return true
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true
  const left = new Set(a.split(" "))
  const right = new Set(b.split(" "))
  const shared = [...left].filter((word) => right.has(word)).length
  return shared / new Set([...left, ...right]).size >= 0.6
}

function redact(message: string, key: string) {
  return key ? message.replaceAll(key, "[key]") : message
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
