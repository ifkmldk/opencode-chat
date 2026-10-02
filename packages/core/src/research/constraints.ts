export type TravelMode = "driving" | "walking" | "transit"

export interface Constraints {
  anchor?: string
  radiusKm: number
  must: string[]
  transitLine?: string
  transitWalkKm?: number
  travelMode: TravelMode
}

const DEFAULT_RADIUS_KM = 5
const TRANSIT_WALK_KM = 1

const MUST_PATTERNS: { test: RegExp; key: string }[] = [
  { test: /carport|garasi\s*mobil|parkir\s*mobil|parkiran\s*mobil/i, key: "carport" },
  { test: /furnished|perabot/i, key: "furnished" },
  { test: /ac\b|air\s*conditioner|pendingin/i, key: "ac" },
  { test: /kamar\s*mandi\s*dalam|km\s*dalam/i, key: "ensuite_bath" },
]

const TRANSIT_PATTERNS: { test: RegExp; line: string }[] = [
  { test: /rangkas\s*bitung|rangkasbitung/i, line: "KRL Rangkasbitung" },
  { test: /bogor\b/i, line: "KRL Bogor" },
  { test: /bekasi\b|cikarang/i, line: "KRL Cikarang" },
  { test: /tangerang\b/i, line: "KRL Tangerang" },
  { test: /serpong|parung\s*panjang/i, line: "KRL Serpong" },
]

export function extractConstraints(query: string, location?: string): Constraints {
  const text = `${query} ${location ?? ""}`
  const must: string[] = []
  for (const pattern of MUST_PATTERNS) {
    if (pattern.test.test(text)) {
      const key = pattern.key.trim()
      if (!must.includes(key)) must.push(key)
    }
  }
  let transitLine: string | undefined
  for (const pattern of TRANSIT_PATTERNS) {
    if (pattern.test.test(text)) {
      transitLine = pattern.line
      break
    }
  }
  const radiusMatch = text.match(/(\d+(?:[.,]\d+)?)\s*km/i)
  const radiusKm = radiusMatch ? Number(radiusMatch[1]!.replace(",", ".")) : transitLine ? TRANSIT_WALK_KM : DEFAULT_RADIUS_KM
  const anchor = location?.trim() || undefined
  const travelMode: TravelMode = transitLine ? "walking" : "driving"
  return {
    ...(anchor ? { anchor } : {}),
    radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : DEFAULT_RADIUS_KM,
    must,
    ...(transitLine ? { transitLine, transitWalkKm: TRANSIT_WALK_KM } : {}),
    travelMode,
  }
}

export const __test = { extractConstraints, DEFAULT_RADIUS_KM, TRANSIT_WALK_KM }
