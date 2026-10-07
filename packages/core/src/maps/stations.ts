export * as Stations from "./stations.js"

import { Geo } from "./geo.js"
import { lines, stations } from "./stations-data.js"

// fork: Jabodetabek rail stations (KRL Commuter Line, MRT Jakarta, LRT) bundled from OpenStreetMap by
// script/stations.ts. Station lookups must not depend on Overpass or Nominatim: both are often down or answer
// "Stasiun X" with a shop named after the station.

export type Mode = "krl" | "mrt" | "lrt"

export type Station = {
  /** OSM railway station object, e.g. "osm:node/9335291125". */
  readonly id: string
  readonly name: string
  readonly aliases: readonly string[]
  /** Line ids from LINES, e.g. ["rangkasbitung"]. */
  readonly lines: readonly string[]
  readonly mode: Mode
  readonly latitude: number
  readonly longitude: number
}

export type Line = {
  readonly id: string
  readonly name: string
  readonly mode: Mode
  /** Station ids in running order. */
  readonly stations: readonly string[]
}

export type Filter = { readonly lines?: readonly string[]; readonly modes?: readonly Mode[] }

export const LINES: readonly Line[] = lines

const byId = new Map(stations.map((station) => [station.id, station]))
const modeOrder: readonly Mode[] = ["krl", "mrt", "lrt"]
// Alias indexes per line/mode scope; there are only a handful of scopes.
const indexes = new Map<string, ReturnType<typeof aliasIndex>>()

/**
 * Stations on the given lines (in running order), or of the given modes. Without lines the default is every KRL
 * station; an empty `lines` array means "all lines" like an absent one.
 */
export function list(filter: Filter = {}): readonly Station[] {
  const modes = filter.modes?.length ? filter.modes : filter.lines?.length ? modeOrder : ["krl"]
  if (!filter.lines?.length) return stations.filter((station) => modes.includes(station.mode))
  const wanted = filter.lines
  const ids = new Set(LINES.filter((line) => wanted.includes(line.id)).flatMap((line) => line.stations))
  return [...ids].flatMap((id) => {
    const station = byId.get(id)
    return station && modes.includes(station.mode) ? [station] : []
  })
}

/**
 * The station a text names: "Stasiun Cisauk", "St. Cisauk", "Cisauk station", "Jurang Mangu", "Parung Panjang",
 * "Stasiun Sudirman, Jakarta". Searches every mode unless the filter or the text ("MRT", "LRT", "KRL") narrows it;
 * when names collide (Cawang is both KRL and LRT) KRL wins, then MRT. A free text only matches a station name inside
 * it when it also says "stasiun"/"station"/"KRL"/…, so "Tangerang Selatan" is not Tangerang station.
 */
export function find(text: string, filter: Filter = {}): Station | undefined {
  const words = normalize(text)
  const marked = words.some((word) => markers.has(word))
  const hinted = (["krl", "mrt", "lrt"] as const).filter(
    (mode) => words.includes(mode) || (mode === "krl" && words.includes("commuter")),
  )
  const modes = filter.modes?.length ? filter.modes : hinted.length ? hinted : modeOrder
  const scope = `${filter.lines?.join(",") ?? ""}|${modes.join(",")}`
  const index = indexes.get(scope) ?? aliasIndex(list({ lines: filter.lines, modes }))
  indexes.set(scope, index)
  if (index.size === 0) return undefined
  const head = clean(normalize(text.split(/[,(]/)[0] ?? ""))
  const full = clean(words)
  const exact = [head, full].map((item) => item.join("")).filter((item) => item.length > 0)
  const direct = exact.flatMap((item) => index.get(item)?.stations ?? [])
  if (direct.length) return pick(direct)
  if (marked) {
    // The longest station name inside the text: "Stasiun Bekasi Timur" is Bekasi Timur, not Bekasi.
    const inside = [...index.entries()]
      .filter((entry) => entry[0].length >= 4 && containsWords(full, entry[1].words))
      .toSorted((a, b) => b[0].length - a[0].length)
    if (inside.length)
      return pick(
        inside.filter((entry) => entry[0].length === inside[0]![0].length).flatMap((entry) => entry[1].stations),
      )
  }
  return fuzzy(exact[0], index)
}

/** Nearest stations by geodesic distance, closest first. Defaults to KRL stations and k = 1. */
export function nearest(point: Geo.Point, options: Filter & { readonly k?: number } = {}) {
  return Geo.nearest(point, list(options), options.k ?? 1).map((entry) => ({
    station: entry.item,
    meters: entry.meters,
  }))
}

/**
 * Line ids a request names: "line rangkas bitung" → ["rangkasbitung"], "KRL jalur Bogor" → ["bogor"],
 * "MRT" → ["mrt-jakarta"]. "KRL" alone or "semua jalur" → [] (every KRL line). When the text names MRT/LRT and
 * KRL in general, every KRL line is listed too so the KRL part is not lost.
 */
export function linesFromText(text: string): readonly string[] {
  const value = normalize(text).join(" ")
  if (/\b(semua|seluruh|all|any|mana saja|apa saja)\s+(jalur|line|lines|lin|rute)\b/.test(value)) return []
  const krl = krlPatterns.filter((entry) => entry.pattern.test(value)).map((entry) => entry.id)
  const other = [
    ...(/\bmrt\b/.test(value) ? ["mrt-jakarta"] : []),
    ...(/\bjabodebek\b/.test(value) ? ["lrt-jabodebek"] : []),
    ...(/\blrt\s+(jakarta|jakpro|kelapa gading|velodrome)\b/.test(value) ? ["lrt-jakarta"] : []),
  ]
  const lrtOnly =
    /\blrt\b/.test(value) && !other.some((id) => id.startsWith("lrt-")) ? ["lrt-jabodebek", "lrt-jakarta"] : []
  const named = [...new Set([...krl, ...other, ...lrtOnly])]
  const generalKrl = /\b(krl|commuter|commuterline)\b/.test(value) && krl.length === 0 && named.length > 0
  const all = generalKrl ? [...LINES.filter((line) => line.mode === "krl").map((line) => line.id), ...named] : named
  return LINES.map((line) => line.id).filter((id) => all.includes(id))
}

// A line name counts only next to a rail word ("jalur bogor", "bogor line", "KRL Bogor") so a city alone is not a line.
const context = String.raw`(?:line|lin|jalur|krl|commuter|commuterline|rute|trayek|kereta)`
const near = (name: string) =>
  new RegExp(String.raw`\b${context}\s+(?:\S+\s+){0,2}?(?:${name})\b|\b(?:${name})\s+${context}\b`)
const krlPatterns = [
  { id: "bogor", pattern: near("bogor|nambo") },
  { id: "cikarang", pattern: near("cikarang|bekasi|lingkar cikarang|loop") },
  { id: "rangkasbitung", pattern: near("rangkas\\s?bitung|rangkas|serpong") },
  { id: "tangerang", pattern: near("tangerang(?!\\s+selatan)|duri tangerang") },
  { id: "tanjung-priok", pattern: near("tanjung\\s?pri[ou]k|pri[ou]k") },
]

// Words that mark a text as naming a station, and words dropped before comparing names.
const markers = new Set("stasiun stasion st stn sta station krl mrt lrt commuter commuterline".split(" "))
const noise = new Set([...markers, ..."line kereta api ka jabodebek kai di the".split(" ")])

function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function clean(words: readonly string[]) {
  return words.filter((word) => !noise.has(word))
}

/** Name and alias keys ("jurangmangu", "parungpanjang") → their words and stations. */
function aliasIndex(scope: readonly Station[]) {
  const index = new Map<string, { words: readonly string[]; stations: Station[] }>()
  scope.forEach((station) =>
    [station.name, ...station.aliases].forEach((alias) => {
      const words = clean(normalize(alias))
      const key = words.join("")
      if (!key) return
      const entry = index.get(key) ?? { words, stations: [] }
      if (!entry.stations.includes(station)) entry.stations.push(station)
      index.set(key, entry)
    }),
  )
  return index
}

function pick(found: readonly Station[]) {
  return found.toSorted((a, b) => modeOrder.indexOf(a.mode) - modeOrder.indexOf(b.mode))[0]
}

function containsWords(text: readonly string[], words: readonly string[]) {
  return text.some((_, start) => words.every((word, offset) => text[start + offset] === word))
}

/** One typo for names of 6+ letters, two for 10+, and only when a single name is that close. */
function fuzzy(key: string | undefined, index: ReturnType<typeof aliasIndex>) {
  if (!key || key.length < 6) return undefined
  const allowed = key.length >= 10 ? 2 : 1
  const close = [...index.entries()].filter(
    (entry) => Math.abs(entry[0].length - key.length) <= allowed && distance(entry[0], key) <= allowed,
  )
  const names = new Set(close.flatMap((entry) => entry[1].stations.map((station) => station.name)))
  if (names.size !== 1) return undefined
  return pick(close.flatMap((entry) => entry[1].stations))
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  Array.from(a).forEach((charA, i) => {
    const previous = [...row]
    row[0] = i + 1
    Array.from(b).forEach((charB, j) => {
      row[j + 1] = Math.min(previous[j + 1]! + 1, row[j]! + 1, previous[j]! + (charA === charB ? 0 : 1))
    })
  })
  return row[b.length]!
}
