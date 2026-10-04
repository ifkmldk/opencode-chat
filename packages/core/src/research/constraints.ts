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
  // fork: anchor-from-query — location eksplisit menang; bila kosong, ekstrak dari query
  // ("sudirman"→Jl. Sudirman Bandung bila bandung disebut, "bsd"→BSD Tangerang Selatan,
  //  "stasiun X"→nama stasiun). Tanpa ini "kontrakan daerah sudirman" kehilangan anchor.
  // Mode koridor transit tidak pakai anchor (radius diukur dari tiap stasiun, bukan 1 titik).
  const anchor = location?.trim() || anchorFromQuery(query, transitLine)
  const travelMode: TravelMode = transitLine ? "walking" : "driving"
  return {
    ...(anchor ? { anchor } : {}),
    radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : DEFAULT_RADIUS_KM,
    must,
    ...(transitLine ? { transitLine, transitWalkKm: TRANSIT_WALK_KM } : {}),
    travelMode,
  }
}

// fork: anchor-from-query — pola umum "daerah X", "sekitar X", "dekat X".
// Hati-hati: jangan potong kata (regex non-greedy "KR" dari "KRL" pernah lolos);
// ambil hingga 4 kata lalu buang stopwords. Bila koridor transit terdeteksi,
// anchor dikosongkan (mode koridor tidak pakai anchor).
function anchorFromQuery(query: string, transitLine?: string): string | undefined {
  if (transitLine) return undefined
  const q = query.toLowerCase()
  const bandung = /bandung/.test(q)
  if (/sudirman/.test(q)) return bandung || /jl\.?\s*sudirman/.test(q) ? "Jl. Sudirman, Bandung" : "Jl. Sudirman, Jakarta"
  const bsd = q.match(/\bbsd\b|bumi\s*serpong\s*damai|serpong/)
  if (bsd) return "BSD, Tangerang Selatan"
  const station = query.match(/stasiun\s+([A-Za-z][A-Za-z\s.'-]{1,40})/i)
  if (station) return `Stasiun ${station[1]!.trim().split(/\s+/).slice(0, 3).join(" ")}`
  const daerah = query.match(/(?:daerah|kawasan|sekitar|dekat|area)\s+([A-Za-z][A-Za-z\s.'-]{1,60})/i)
  if (daerah) {
    const stop = new Set(["yang", "dengan", "ada", "dekat", "area", "bisa", "dari", "untuk", "dan", "di"])
    const words = daerah[1]!.trim().split(/\s+/).filter(Boolean)
    // Jangan ambil singkatan transit sebagai anchor ("KRL", "MRT", "LRT").
    if (words.length && ["krl", "mrt", "lrt", "krl,"].includes(words[0]!.toLowerCase())) return undefined
    const kept = words.slice(0, 4).filter((w, i, arr) => !(stop.has(w.toLowerCase()) && i === arr.length - 1))
    const cleaned = kept.filter((w) => !stop.has(w.toLowerCase()) || kept.indexOf(w) < 2).slice(0, 4).join(" ").trim()
    if (cleaned && cleaned.length >= 3) return cleaned
  }
  return undefined
}

export const __test = { extractConstraints, DEFAULT_RADIUS_KM, TRANSIT_WALK_KM }
