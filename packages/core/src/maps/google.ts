export * as MapsGoogle from "./google.js"

import type { Geo } from "./geo.js"
import { MapsError } from "./error.js"

// fork: OSM-only (Google/Gemini removed — no key, never billed). File ini dipertahankan
// sebagai shim agar import lama + test tidak pecah; semua fungsi runtime melempar
// error jujur. Rich info (foto/rating/review) hanya dari OSM/Wikimedia/scrape berattribusi.

export const models = [] as const

export const __test = { reset: () => {} }

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

const OSM_ONLY = "Maps is OSM-only now (Google/Gemini removed — no key, never billed). Use maps_search (OpenStreetMap) instead."

/** OSM-only shim: selalu gagal jujur agar caller fallback ke OSM, tidak pernah bill. */
export async function places(_key: string, _input: { query: string; near?: Geo.Point; limit: number; openNow?: boolean }) {
  throw new MapsError({ service: "gemini", kind: "disabled", message: OSM_ONLY })
}

/** OSM-only shim. */
export async function ask(_key: string, _input: { question: string; near?: Geo.Point }) {
  throw new MapsError({ service: "gemini", kind: "disabled", message: OSM_ONLY })
}

/** OSM-only shim. */
export async function test(_key: string) {
  throw new MapsError({ service: "gemini", kind: "disabled", message: OSM_ONLY })
}

/** OSM-only shim. */
export async function generate(_key: string, _prompt: string, _near?: Geo.Point) {
  throw new MapsError({ service: "gemini", kind: "disabled", message: OSM_ONLY })
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

/** The reply should be a bare JSON array, but models sometimes wrap it in prose or a code fence. */
export function parseItems(text: string): { name: string }[] {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((raw: unknown) => {
      if (!raw || typeof raw !== "object" || typeof (raw as { name?: unknown }).name !== "string") return []
      return [{ name: (raw as { name: string }).name.trim() }]
    })
  } catch {
    return []
  }
}

function redact(message: string, key: string) {
  return key ? message.replaceAll(key, "[key]") : message
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
