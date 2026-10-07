import { MapsCategory } from "../maps/categories.js"
import { Stations } from "../maps/stations.js"
import { Salary } from "../scrape/salary.js"

// fork: the hard constraints of a research question. City names alone never mean a train line ("hotel di BSD
// Tangerang" is not the KRL Tangerang corridor); only rail words (KRL, stasiun, commuter, kereta, MRT, LRT) do, and a
// named station ("dari stasiun Sudirman") is the station, not the street.

export type TravelMode = "driving" | "walking" | "transit"

/** How an office may be reached from a station: on foot only, or also by one direct bus/angkot ride. */
export type AccessMode = "walk" | "walk_or_one_transit"

export interface Constraints {
  /** The place the question is around: "Pranaya Boutique Hotel BSD", "Stasiun Serpong", "bsd tangerang". */
  anchor?: string
  /** "near" for "dekat/sekitar/dari X" (a distance from X matters), "in" for "di X" (X is the area searched). */
  anchorKind?: "near" | "in"
  /** The anchor is a KRL/MRT/LRT station. */
  station?: Stations.Station
  radiusKm: number
  /** The text gave the radius ("<1km", "500 m", "jalan kaki"); otherwise radiusKm is a default. */
  radiusExplicit: boolean
  must: string[]
  /** Places near stations were asked for: every station of these lines, or only the named stations. */
  transit?: { readonly lines: readonly string[]; readonly stations: readonly Stations.Station[] }
  /** Readable form of `transit` ("KRL semua jalur", "KRL Rangkasbitung", "Stasiun Serpong"). */
  transitLine?: string
  transitWalkKm?: number
  travelMode: TravelMode
  /** Monthly salary floor in rupiah ("di atas 11 juta" → 11 000 000). */
  minSalary?: number
  /** Place category asked for ("rumah sakit" → hospital). */
  kind?: MapsCategory.Kind
  /** Set when the text allows one direct public-transport ride from the station ("atau 1x naik transum dari stasiun"). */
  accessMode?: AccessMode
}

const DEFAULT_RADIUS_KM = 3
const TRANSIT_WALK_KM = 1
// About 80 m per minute on foot.
const WALK_METERS_PER_MINUTE = 80

const MUST: { key: string; pattern: string }[] = [
  { key: "carport", pattern: String.raw`carport|car port|garasi(?:\s+mobil)?|parkir(?:an)?\s+mobil` },
  { key: "furnished", pattern: String.raw`(?:full(?:y|ly)?\s*)?furnished|perabot(?:an)?|furnish` },
  { key: "ac", pattern: String.raw`ac|air\s*conditioner|air\s*con|pendingin(?:\s+ruangan)?` },
  { key: "ensuite_bath", pattern: String.raw`kamar\s*mandi\s*dalam|km\s*dalam|en[\s-]?suite` },
]

export function extractConstraints(query: string, location?: string): Constraints {
  const text = `${query} ${location ?? ""}`
  const must = MUST.filter((item) => mustPattern(item.key).test(text)).map((item) => item.key)
  const rail = RAIL.test(query)
  const stations = rail ? namedStations(query) : []
  const walking = WALKING.test(query)
  const transit = rail ? transitScope(query, stations) : undefined
  const explicit = radiusFrom(query)
  const radiusKm = explicit ?? (walking || transit ? TRANSIT_WALK_KM : DEFAULT_RADIUS_KM)
  const named = anchorFromQuery(query)
  const station = stations[0]
  const area = location?.trim()
  // An explicit location wins when it already contains the named place ("sudirman" inside "Jl. Sudirman, Bandung").
  const anchor = station
    ? `Stasiun ${station.name}`
    : named && !(area && plain(area).includes(plain(named.text)))
      ? named.text
      : area || named?.text
  const anchorKind = station ? "near" : anchor === named?.text ? named?.kind : area ? "in" : undefined
  const minSalary = salaryFloor(query)
  const kind = MapsCategory.fromText(query)
  return {
    ...(anchor ? { anchor, anchorKind } : {}),
    ...(station ? { station } : {}),
    radiusKm,
    radiusExplicit: explicit !== undefined,
    must,
    ...(transit
      ? { transit, transitLine: transitLabel(transit), transitWalkKm: explicit ?? TRANSIT_WALK_KM }
      : {}),
    travelMode: walking || transit ? "walking" : "driving",
    ...(minSalary !== undefined ? { minSalary } : {}),
    ...(kind ? { kind } : {}),
    ...(transit && ONE_RIDE.test(query) ? { accessMode: "walk_or_one_transit" as const } : {}),
  }
}

/** Word-bounded test for a must-have ("ac" is not inside "contact", "furnished" is not "unfurnished"). */
export function mustPattern(key: string) {
  const known = MUST.find((item) => item.key === key)?.pattern
  const source = known ?? key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, String.raw`[\s_-]*`)
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${source})(?![\p{L}\p{N}])`, "iu")
}

/** The page says the opposite: "tanpa AC", "non-AC", "unfurnished", "tidak ada carport". */
export function mustNegated(key: string) {
  const known = MUST.find((item) => item.key === key)?.pattern
  const source = known ?? key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, String.raw`[\s_-]*`)
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:(?:tanpa|tidak\s+ada|tdk\s+ada|ga\s+ada|gak\s+ada|non|no|bukan|without)[\s-]*|un)(?:${source})(?![\p{L}\p{N}])`,
    "iu",
  )
}

/**
 * Transit line ids for a free text such as the transitLine field ("KRL Rangkasbitung", "KRL", "semua jalur",
 * "bogor"); every KRL line when it names none.
 */
export function linesOf(text: string) {
  if (ALL_LINES.test(text)) return krlLines()
  const named = Stations.linesFromText(/\b(krl|mrt|lrt|jalur|line|commuter)\b/i.test(text) ? text : `jalur ${text}`)
  return named.length ? [...named] : krlLines()
}

function transitScope(query: string, stations: readonly Stations.Station[]) {
  if (stations.length) return { lines: [] as string[], stations }
  return { lines: linesOf(query), stations: [] as Stations.Station[] }
}

function transitLabel(transit: { lines: readonly string[]; stations: readonly Stations.Station[] }) {
  if (transit.stations.length)
    return transit.stations.map((station) => `Stasiun ${station.name}`).join(", ")
  const krl = krlLines()
  const all = krl.every((id) => transit.lines.includes(id))
  const names = transit.lines.filter((id) => !all || !krl.includes(id)).map(lineName)
  return [all ? "KRL semua jalur" : "", ...names].filter(Boolean).join(", ")
}

function krlLines() {
  return Stations.LINES.filter((line) => line.mode === "krl").map((line) => line.id)
}

function lineName(id: string) {
  return Stations.LINES.find((line) => line.id === id)?.name.replace(/^KRL Commuter Line/, "KRL") ?? id
}

/** Stations the text names after a rail word: "dari stasiun Sudirman", "St. Tanah Abang", "Cisauk station". */
function namedStations(query: string) {
  const found = [...query.matchAll(STATION_NAME)].flatMap((match) => {
    const words = cut(match[1] ?? match[2] ?? "").split(" ").filter(Boolean)
    // "Stasiun Bekasi Timur KRL" → try the longest name first.
    const station = [3, 2, 1]
      .filter((size) => size <= words.length)
      .map((size) => Stations.find(`stasiun ${words.slice(0, size).join(" ")}`))
      .find((item) => item !== undefined)
    return station ? [station] : []
  })
  return [...new Map(found.map((station) => [station.id, station])).values()]
}

function radiusFrom(query: string) {
  const minutes = query.match(/(\d+)\s*(?:menit|mnt|min(?:ute)?s?)\s+(?:jalan\s+kaki|jalan|walk(?:ing)?)/i)
  if (minutes) return (Number(minutes[1]) * WALK_METERS_PER_MINUTE) / 1000
  const match = query.match(
    /(?<!(?:rp\.?|idr|gaji)\s*)(\d+(?:[.,]\d+)?)\s*(km|kilometer|kilo|meter|mtr|m)(?![\p{L}\p{N}])/iu,
  )
  if (!match) return undefined
  const value = Number(match[1]!.replace(",", "."))
  const km = /^(km|kilometer|kilo)$/i.test(match[2]!) ? value : value / 1000
  return Number.isFinite(km) && km > 0 ? km : undefined
}

function salaryFloor(query: string) {
  const lower = query.toLowerCase()
  // "minimal 2 tahun pengalaman" also reads like a floor; only a rupiah-sized amount counts.
  return [SALARY_FLOOR, SALARY_PLUS, SALARY_PLAIN]
    .flatMap((pattern) => [...lower.matchAll(pattern)])
    .map((match) => Salary.amount(match[1]!, match[2]))
    .find((value) => value >= 100_000)
}

/** "dekat X", "dari X", "sekitar X", "near X" (a distance from X), or "di X" / "daerah X" (an area). */
function anchorFromQuery(query: string): { text: string; kind: "near" | "in" } | undefined {
  const candidates = [...query.matchAll(ANCHOR)].flatMap((match) => {
    const trigger = match[1]!.toLowerCase().replace(/\s+/g, " ")
    const text = cut(match[2] ?? "")
    if (!text || text.length < 2) return []
    // "dari KRL", "dekat stasiun", "dari line rangkas bitung" name the rail network, not a place.
    if (RAIL_ONLY.test(text)) return []
    const kind: "near" | "in" = AREA_TRIGGERS.has(trigger) ? "in" : "near"
    return [{ text, kind }]
  })
  return candidates.find((item) => item.kind === "near") ?? candidates[0]
}

/** The place words after a trigger, up to punctuation or a connector ("BSD Tangerang rating bagus" → "BSD Tangerang"). */
function cut(text: string) {
  const words = text.split(/[.,;:!?()\n]/)[0]!.trim().split(/\s+/)
  const end = words.findIndex((word) => STOP.has(word.toLowerCase()) || /^[<>≤≥]?\d/.test(word))
  return (end < 0 ? words : words.slice(0, end)).slice(0, 5).join(" ").trim()
}

function plain(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

const RAIL = /(?<![\p{L}\p{N}])(krl|commuter\s*line|commuterline|commuter|kereta|stasiun|stasion|station|st\.|stn|mrt|lrt)(?![\p{L}\p{N}])/iu
const RAIL_ONLY = /^(?:(?:krl|commuter|commuterline|line|jalur|lin|kereta|stasiun|station|st\.?|mrt|lrt|tsb|tersebut|itu|ini|terdekat|manapun|mana\s*saja|lain|lainnya|yang|yg)\b\s*)+(?:(?:rangkas\s*bitung|rangkasbitung|bogor|cikarang|bekasi|tangerang|tanjung\s*priok|priok|serpong|nambo|loop)\b\s*)*$/i
const ALL_LINES =
  /\b(line|jalur|lin|rute)\s+(lain|lainnya|mana\s*(saja|aja)|apa\s*(saja|aja)|apapun|manapun)\b|\b(semua|seluruh|all|any|every)\s+(jalur|line|lines|rute)\b|^\s*(krl|commuter|commuter\s*line|semua|all)\s*$/i
// "atau 1x naik transum langsung dari stasiun", "sekali naik bus/TransJakarta/angkot/mikrotrans", "one bus ride".
const ONE_RIDE =
  /(?<![\p{L}\p{N}])(?:(?:1\s*x|1\s+kali|sekali|satu\s+kali)\s+(?:naik\s+|nyambung\s+)?(?:transum|transportasi\s+umum|angkutan\s+umum|kendaraan\s+umum|angkot|bus|bis|busway|transjakarta|tj|mikrotrans|jak\s*lingko|feeder)|naik\s+(?:transum|transportasi\s+umum|angkutan\s+umum|angkot|bus|busway|transjakarta|tj|mikrotrans|jak\s*lingko|feeder)\s+(?:langsung\s+)?dari\s+stasiun|one\s+(?:direct\s+)?(?:bus|transit|public\s+transport)\s+ride)(?![\p{L}\p{N}])/iu
const WALKING = /jalan\s+kaki|bisa\s+jalan|jalan\s+dari\s+stasiun|walk(?:ing|able)?\b/i
const STATION_NAME =
  /(?<![\p{L}\p{N}])(?:stasiun|stasion|st\.|stn)\s+((?:[\p{L}][\p{L}'-]*\s*){1,4})|((?:[\p{L}][\p{L}'-]*\s+){1,3})station\b/giu
const ANCHOR =
  /(?<![\p{L}\p{N}])(di\s+sekitar|disekitar|sekitaran|sekitar|seputar|di\s+dekat|didekat|dekat|deket|dkt|near(?:by)?|close\s+to|around|dari|from|daerah|kawasan|area|lokasi\s+di|di|in)\s+(?!atas\b|bawah\b|bidang\b|mana\b|sini\b|situ\b)([^\n.,;:!?()]+)/giu
const AREA_TRIGGERS = new Set(["di", "in", "daerah", "kawasan", "area", "lokasi di"])
// Words that end a place name in running text.
const STOP = new Set(
  "yang yg dengan dgn untuk utk buat dan atau tapi tetapi namun bisa boleh wajib harus radius jarak max maks maksimal maksimum minimal min budget harga gaji rating bagus murah termurah ada punya jalan kaki terdekat paling hemat ongkos supaya agar biar karena krn sama serta lokasi lokasinya posisi loker lowongan kerja jalur line lin rute with and or for that which near within under below rating rated cheap budget price".split(
    " ",
  ),
)
const SALARY_FLOOR =
  /(?:di\s*atas|diatas|lebih\s+dari|minimal|minimum|min\.?|paling\s+sedikit|at\s+least|above|over|mulai|starting|>=?|≥)\s*(?:rp\.?|idr)?\s*(\d+(?:[.,]\d+)?)\s*(juta|jtan|jt|million|mio|ribu|rb|k)?(?![\p{L}])/gu
const SALARY_PLUS = /(\d+(?:[.,]\d+)?)\s*(juta|jt)\s*\+/g
const SALARY_PLAIN =
  /(?:gaji|salary|upah)\s*(?:rp\.?|idr)?\s*(\d+(?:[.,]\d+)?)\s*(juta|jtan|jt|million|mio)(?![\p{L}])/gu

export const __test = { extractConstraints, DEFAULT_RADIUS_KM, TRANSIT_WALK_KM }
