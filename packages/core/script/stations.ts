#!/usr/bin/env bun
// fork: builds src/maps/stations-data.ts, the Jabodetabek rail stations (KRL Commuter Line, MRT Jakarta, LRT), from
// OpenStreetMap. Route relations give each line's stations in running order; every coordinate comes from an OSM
// railway=station/halt object whose id is recorded. A curated name list per KRL line checks the relations and fills
// stations they miss (by station name in the Jabodetabek bbox, then Nominatim's railway layer as a last resort).
// Overpass often answers 504, so mirrors are tried in turn with backoff; --save keeps the raw answer and --from
// rebuilds from it without the network.
//
//   bun run script/stations.ts [--save overpass.json] [--from overpass.json] [--allow-missing]

import path from "node:path"
import { parseArgs } from "node:util"
import { Geo } from "../src/maps/geo"

type Mode = "krl" | "mrt" | "lrt"
type Tags = Record<string, string>
type Member = { type: "node" | "way" | "relation"; ref: number; role: string }
type Element = {
  type: "node" | "way" | "relation"
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Tags
  members?: Member[]
}
type Found = { key: string; latitude: number; longitude: number; tags: Tags; stop?: string }

const args = parseArgs({
  args: process.argv.slice(2),
  options: { save: { type: "string" }, from: { type: "string" }, "allow-missing": { type: "boolean" } },
})

const userAgent = "OpenCode/2 station data builder (+https://opencode.ai)"
// south, west, north, east: Rangkasbitung to Cikarang, Tanjung Priok to Bogor.
const bbox = { south: -6.8, west: 105.9, north: -5.9, east: 107.3 }
const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`

const lines: readonly { id: string; name: string; mode: Mode; curated?: readonly string[] }[] = [
  {
    id: "bogor",
    name: "KRL Commuter Line Bogor",
    mode: "krl",
    curated: [
      "Jakarta Kota",
      "Jayakarta",
      "Mangga Besar",
      "Sawah Besar",
      "Juanda",
      "Gondangdia",
      "Cikini",
      "Manggarai",
      "Tebet",
      "Cawang",
      "Duren Kalibata",
      "Pasar Minggu Baru",
      "Pasar Minggu",
      "Tanjung Barat",
      "Lenteng Agung",
      "Universitas Pancasila",
      "Universitas Indonesia",
      "Pondok Cina",
      "Depok Baru",
      "Depok",
      "Citayam",
      "Bojonggede",
      "Cilebut",
      "Bogor",
      "Cibinong",
      "Nambo",
    ],
  },
  {
    id: "cikarang",
    name: "KRL Commuter Line Cikarang",
    mode: "krl",
    // BNI City has served Cikarang loop trains since 2022. Karet closed on 2026-09-01 (OSM: disused:railway=station) and
    // its passengers use BNI City, so it is left out.
    curated: [
      "Cikarang",
      "Metland Telagamurni",
      "Cibitung",
      "Tambun",
      "Bekasi Timur",
      "Bekasi",
      "Kranji",
      "Cakung",
      "Klender Baru",
      "Buaran",
      "Klender",
      "Jatinegara",
      "Pondok Jati",
      "Kramat",
      "Gang Sentiong",
      "Pasar Senen",
      "Kemayoran",
      "Rajawali",
      "Kampung Bandan",
      "Angke",
      "Duri",
      "Tanah Abang",
      "BNI City",
      "Sudirman",
      "Manggarai",
      "Matraman",
    ],
  },
  {
    id: "rangkasbitung",
    name: "KRL Commuter Line Rangkasbitung",
    mode: "krl",
    curated: [
      "Tanah Abang",
      "Palmerah",
      "Kebayoran",
      "Pondok Ranji",
      "Jurangmangu",
      "Sudimara",
      "Rawa Buntu",
      "Serpong",
      "Cisauk",
      "Cicayur",
      "Jatake",
      "Parungpanjang",
      "Cilejit",
      "Daru",
      "Tenjo",
      "Tigaraksa",
      "Cikoya",
      "Maja",
      "Citeras",
      "Rangkasbitung",
    ],
  },
  {
    id: "tangerang",
    name: "KRL Commuter Line Tangerang",
    mode: "krl",
    curated: [
      "Duri",
      "Grogol",
      "Pesing",
      "Taman Kota",
      "Bojong Indah",
      "Rawa Buaya",
      "Kalideres",
      "Poris",
      "Batu Ceper",
      "Tanah Tinggi",
      "Tangerang",
    ],
  },
  {
    id: "tanjung-priok",
    name: "KRL Commuter Line Tanjung Priok",
    mode: "krl",
    curated: ["Jakarta Kota", "Kampung Bandan", "Ancol", "Jakarta International Stadium", "Tanjung Priuk"],
  },
  { id: "mrt-jakarta", name: "MRT Jakarta", mode: "mrt" },
  { id: "lrt-jabodebek", name: "LRT Jabodebek", mode: "lrt" },
  { id: "lrt-jakarta", name: "LRT Jakarta", mode: "lrt" },
]

// Spellings people use that OSM does not carry; keyed by the OSM name.
const extraAliases: Record<string, readonly string[]> = {
  Parungpanjang: ["Parung Panjang"],
  Jurangmangu: ["Jurang Mangu"],
  Bojonggede: ["Bojong Gede"],
  "Rawa Buntu": ["Rawabuntu"],
  "Pondok Ranji": ["Pondokranji"],
  "Tanjung Priuk": ["Tanjung Priok"],
  "Jakarta Kota": ["Beos"],
  "Pasar Senen": ["Senen"],
  "Universitas Indonesia": ["UI"],
  "Universitas Pancasila": ["UP"],
  "Pondok Cina": ["Pocin", "Pondok China"],
  "Metland Telagamurni": ["Telaga Murni", "Telagamurni"],
  "BNI City": ["Sudirman Baru"],
  Kebayoran: ["Kebayoran Lama"],
  "Batu Ceper": ["Batuceper"],
  "Rawa Buaya": ["Rawabuaya"],
  "Duren Kalibata": ["Kalibata"],
  Tigaraksa: ["Tiga Raksa"],
  "Kampung Bandan": ["Kampungbandan"],
  "Tanah Abang": ["Tanahabang"],
}

const relationQuery = `[out:json][timeout:180];
(
  relation["type"="route"]["route"="train"]["network"~"KAI Commuter|KRL|KCI|KCJ",i](${box});
  relation["type"="route"]["route"="subway"]["network"~"MRT Jakarta",i](${box});
  relation["type"="route"]["route"="light_rail"]["network"~"LRT",i](${box});
)->.routes;
.routes out body;
node(r.routes)->.stops;
.stops out body;
rel(bn.stops)["public_transport"="stop_area"]->.areas;
.areas out body;
nwr["railway"~"^(station|halt)$"](${box});
out center tags;`

const raw = args.values.from ? await Bun.file(args.values.from).json() : await overpass(relationQuery)
if (args.values.save) await Bun.write(args.values.save, JSON.stringify(raw))
const response = raw as { osm3s?: { timestamp_osm_base?: string }; elements: Element[] }

const elements = new Map<string, Element>()
response.elements.forEach((element) => {
  const key = `${element.type}/${element.id}`
  const known = elements.get(key)
  elements.set(key, { ...known, ...element, tags: { ...known?.tags, ...element.tags } })
})
const all = [...elements.values()]
const stationObjects = all.filter(isStation)
const stopAreas = all.filter((element) => element.type === "relation" && element.tags?.public_transport === "stop_area")
const routes = all
  .filter((element) => element.type === "relation" && element.tags?.type === "route")
  .flatMap((element) => {
    const line = lineOf(element.tags ?? {})
    if (!line) return []
    const stops = (element.members ?? []).filter((member) => member.type === "node" && /^stop/.test(member.role))
    return stops.length ? [{ line, relation: element, stops }] : []
  })

const warnings: string[] = []
const missing: string[] = []
const resolved = new Map<string, Found[]>()
const relationsByLine = new Map<string, number[]>()

for (const line of lines) {
  // Longest relation first (lowest id on ties) so the order follows one full run; other directions and branches add
  // the stations it lacks (Nambo after Bogor).
  const own = routes
    .filter((route) => route.line === line.id)
    .toSorted((a, b) => b.stops.length - a.stops.length || a.relation.id - b.relation.id)
  relationsByLine.set(
    line.id,
    own.map((route) => route.relation.id),
  )
  const run = dedupe(
    own.flatMap((route) =>
      route.stops.flatMap((member) => {
        const stop = elements.get(`node/${member.ref}`)
        const station = stop ? stationForStop(stop, line.mode) : undefined
        if (!station)
          warnings.push(
            `${line.id}: stop node/${member.ref} (${stop?.tags?.name ?? "?"}) has no ${line.mode} station object`,
          )
        return station ? [{ ...station, stop: stop?.tags?.name }] : []
      }),
    ),
  )
  const curated = line.curated ?? []
  // Run in the curated direction (from Jakarta outwards) so a filled-in station goes right after its predecessor.
  const positions = run
    .map((station) => curated.findIndex((name) => sameStation(station, name)))
    .filter((index) => index >= 0)
  const ordered = positions.length > 1 && positions[0]! > positions.at(-1)! ? run.toReversed() : run
  for (const [index, name] of curated.entries()) {
    if (ordered.some((station) => sameStation(station, name))) continue
    const neighbour = curated
      .slice(0, index)
      .toReversed()
      .map((previous) => ordered.find((station) => sameStation(station, previous)))
      .find((station) => station !== undefined)
    const found = byName(name, line.mode, neighbour) ?? (await nominatimStation(name, neighbour))
    if (!found) {
      missing.push(`${line.id}: ${name}`)
      continue
    }
    warnings.push(`${line.id}: ${name} is not a stop of the line's route relations; added ${found.key}`)
    const at = neighbour ? ordered.indexOf(neighbour) + 1 : 0
    ordered.splice(at, 0, found)
  }
  ordered
    .filter((station) => curated.length && !curated.some((name) => sameStation(station, name)))
    .forEach((station) =>
      warnings.push(`${line.id}: ${station.tags.name} (${station.key}) is on the route but not in the curated list`),
    )
  resolved.set(line.id, ordered)
}

const stations = new Map<string, { found: Found; mode: Mode; lines: string[]; stops: Set<string> }>()
for (const line of lines) {
  for (const found of resolved.get(line.id) ?? []) {
    const known = stations.get(found.key)
    if (known && known.mode !== line.mode)
      warnings.push(`${found.key} is both ${known.mode} and ${line.mode}; kept ${known.mode}`)
    const entry = known ?? { found, mode: line.mode, lines: [], stops: new Set<string>() }
    if (!entry.lines.includes(line.id)) entry.lines.push(line.id)
    if (found.stop) entry.stops.add(found.stop)
    stations.set(found.key, entry)
  }
}

const output = [...stations.values()].map((entry) => {
  const name = entry.found.tags.name ?? entry.found.stop ?? entry.found.key
  return {
    id: `osm:${entry.found.key}`,
    name,
    aliases: aliasesOf(name, entry.found.tags, [...entry.stops, ...(extraAliases[name] ?? [])]),
    lines: entry.lines,
    mode: entry.mode,
    latitude: Number(entry.found.latitude.toFixed(7)),
    longitude: Number(entry.found.longitude.toFixed(7)),
  }
})
const lineOutput = lines
  .map((line) => ({
    id: line.id,
    name: line.name,
    mode: line.mode,
    stations: (resolved.get(line.id) ?? []).map((station) => `osm:${station.key}`),
  }))
  .filter((line) => line.stations.length > 0)

warnings.forEach((warning) => console.warn(`note: ${warning}`))
console.log("\nStations per line")
lineOutput.forEach((line) =>
  console.log(
    `  ${line.id.padEnd(14)} ${String(line.stations.length).padStart(3)}  relations ${relationsByLine.get(line.id)?.join(", ") || "none"}`,
  ),
)
console.log(`  total stations ${output.length} (krl ${output.filter((station) => station.mode === "krl").length})`)
console.log("\nSpot checks")
for (const name of [
  "Cisauk",
  "Jatake",
  "Cicayur",
  "Sudirman",
  "Palmerah",
  "Rawa Buntu",
  "Tanah Abang",
  "Manggarai",
  "Bogor",
  "Bekasi",
  "Cikarang",
  "Tangerang",
  "Rangkasbitung",
  "Parungpanjang",
]) {
  const station = output.find((item) => item.mode === "krl" && key(item.name) === key(name))
  console.log(
    station
      ? `  ${name.padEnd(14)} ${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}  ${station.id}  ${station.lines.join(", ")}`
      : `  ${name.padEnd(14)} MISSING`,
  )
}
if (missing.length) {
  console.error(`\nUnresolved curated stations:\n  ${missing.join("\n  ")}`)
  if (!args.values["allow-missing"]) {
    console.error("Refusing to write stations-data.ts (pass --allow-missing to write anyway).")
    process.exit(1)
  }
}

const target = path.join(import.meta.dir, "../src/maps/stations-data.ts")
const { format } = await import("prettier")
const source = `// fork: generated by script/stations.ts from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0); do not edit.
// OSM data as of ${response.osm3s?.timestamp_osm_base ?? "unknown"}. Rebuild with \`bun run script/stations.ts\`.

import type { Stations } from "./stations.js"

export const lines: readonly Stations.Line[] = ${JSON.stringify(lineOutput)}

export const stations: readonly Stations.Station[] = ${JSON.stringify(output)}
`
await Bun.write(target, await format(source, { parser: "typescript", semi: false, printWidth: 120 }))
console.log(`\nWrote ${output.length} stations on ${lineOutput.length} lines to ${target}`)

function lineOf(tags: Tags) {
  const network = tags.network ?? ""
  const name = `${tags.name ?? ""} ${tags["name:en"] ?? ""}`
  if (tags.state === "proposed" || tags.disused === "yes") return undefined
  if (tags.route === "subway") return /mrt jakarta/i.test(network) ? "mrt-jakarta" : undefined
  if (tags.route === "light_rail") {
    if (/jabodebek/i.test(network)) return "lrt-jabodebek"
    return /lrt jakarta/i.test(network) ? "lrt-jakarta" : undefined
  }
  if (tags.route !== "train" || !/kai commuter|krl|kci|kcj/i.test(network)) return undefined
  // Airport, Merak and Walahar services are KAI Commuter too but are not KRL lines of Jabodetabek.
  if (/soekarno|bandara|airport|merak|walahar|purwakarta/i.test(name)) return undefined
  const byRef: Record<string, string> = {
    B: "bogor",
    C: "cikarang",
    R: "rangkasbitung",
    T: "tangerang",
    TP: "tanjung-priok",
  }
  if (tags.ref && byRef[tags.ref]) return byRef[tags.ref]
  if (/bogor|nambo/i.test(name)) return "bogor"
  if (/cikarang|bekasi|lingkar/i.test(name)) return "cikarang"
  if (/rangkasbitung|serpong/i.test(name)) return "rangkasbitung"
  if (/tanjung pri/i.test(name)) return "tanjung-priok"
  if (/tangerang/i.test(name)) return "tangerang"
  return undefined
}

function isStation(element: Element) {
  return (
    element.type !== "relation" && /^(station|halt)$/.test(element.tags?.railway ?? "") && point(element) !== undefined
  )
}

function modeOf(tags: Tags): Mode | undefined {
  if (tags.station === "subway" || tags.subway === "yes") return "mrt"
  if (tags.station === "light_rail" || tags.station === "monorail" || tags.light_rail === "yes") return "lrt"
  if (/whoosh|kereta cepat|high.speed/i.test(tags.network ?? "")) return undefined
  return "krl"
}

function point(element: Element) {
  if (element.lat !== undefined && element.lon !== undefined) return { latitude: element.lat, longitude: element.lon }
  if (element.center) return { latitude: element.center.lat, longitude: element.center.lon }
  return undefined
}

function asFound(element: Element): Found {
  return { key: `${element.type}/${element.id}`, ...point(element)!, tags: element.tags ?? {} }
}

/** The station object a route stop belongs to: the stop itself, its stop_area's station, or a nearby same-name one. */
function stationForStop(stop: Element, mode: Mode) {
  const fits = (element: Element) => isStation(element) && modeOf(element.tags ?? {}) === mode
  if (fits(stop)) return asFound(stop)
  const at = point(stop)
  if (!at) return undefined
  const inArea = stopAreas
    .filter((area) => area.members?.some((member) => member.type === "node" && member.ref === stop.id))
    .flatMap((area) => (area.members ?? []).flatMap((member) => elements.get(`${member.type}/${member.ref}`) ?? []))
    .filter(fits)
  const nearby = Geo.nearest(at, (inArea.length ? inArea : stationObjects.filter(fits)).map(asFound)).filter(
    (entry) => entry.meters <= (inArea.length ? 1000 : 700),
  )
  const sameName = nearby.find((entry) =>
    names(entry.item.tags).some((name) => key(name) === key(stop.tags?.name ?? "")),
  )
  if (sameName) return sameName.item
  return nearby.find((entry) => inArea.length || entry.meters <= 300)?.item
}

/** A station object of the mode with this name (or a known spelling), nearest to the line's previous station. */
function byName(name: string, mode: Mode, neighbour: Found | undefined) {
  const wanted = [name, ...(extraAliases[name] ?? [])].map(key)
  const matches = stationObjects
    .filter(
      (element) =>
        modeOf(element.tags ?? {}) === mode && names(element.tags ?? {}).some((value) => wanted.includes(key(value))),
    )
    .map(asFound)
  if (!neighbour) return matches[0]
  return Geo.nearest(neighbour, matches)[0]?.item
}

/** Last resort: Nominatim's railway layer inside the bbox; only railway station objects are accepted. */
async function nominatimStation(name: string, neighbour: Found | undefined): Promise<Found | undefined> {
  if (args.values.from) return undefined
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.search = new URLSearchParams({
    q: `Stasiun ${name}`,
    format: "jsonv2",
    countrycodes: "id",
    viewbox: `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`,
    bounded: "1",
    layer: "railway",
    extratags: "1",
    namedetails: "1",
    limit: "5",
  }).toString()
  await Bun.sleep(1100)
  const response = await fetch(url, { headers: { "user-agent": userAgent, accept: "application/json" } })
  if (!response.ok) return undefined
  const rows = (await response.json()) as {
    osm_type: string
    osm_id: number
    lat: string
    lon: string
    category: string
    type: string
    name?: string
    extratags?: Tags | null
    namedetails?: Tags | null
  }[]
  const stations = rows
    .filter((row) => row.category === "railway" && /^(station|halt)$/.test(row.type))
    .map((row) => ({
      key: `${row.osm_type}/${row.osm_id}`,
      latitude: Number(row.lat),
      longitude: Number(row.lon),
      tags: { ...row.extratags, ...row.namedetails, railway: row.type, ...(row.name ? { name: row.name } : {}) },
    }))
    .filter((station) => names(station.tags).some((value) => key(value) === key(name)))
  if (!neighbour) return stations[0]
  return Geo.nearest(neighbour, stations)[0]?.item
}

async function overpass(query: string): Promise<unknown> {
  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ]
  for (const round of [0, 1, 2, 3]) {
    for (const url of mirrors) {
      const started = Date.now()
      const response = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "user-agent": userAgent, accept: "application/json" },
        signal: AbortSignal.timeout(200_000),
      }).catch((cause: unknown) => cause)
      if (!(response instanceof Response)) {
        console.warn(`overpass ${url}: ${String(response)}`)
        continue
      }
      const text = await response.text()
      const seconds = ((Date.now() - started) / 1000).toFixed(0)
      // Overpass reports its own timeouts as HTTP 200 with a "remark" and partial data.
      const data =
        response.ok && text.startsWith("{")
          ? (JSON.parse(text) as { remark?: string; elements?: unknown[] })
          : undefined
      if (data?.elements?.length && !/error|timed out|out of memory/i.test(data.remark ?? "")) {
        console.log(`overpass ${url}: ${data.elements.length} elements in ${seconds}s`)
        return data
      }
      console.warn(`overpass ${url}: HTTP ${response.status} after ${seconds}s ${data?.remark ?? ""}`)
      await Bun.sleep(3000)
    }
    await Bun.sleep(15_000 * 2 ** round)
  }
  throw new Error("Every Overpass mirror failed; try again later or pass --from with a saved answer")
}

function names(tags: Tags) {
  return ["name", "alt_name", "name:id", "official_name", "short_name", "abbr_name", "old_name", "loc_name"]
    .flatMap((field) => (tags[field] ?? "").split(";"))
    .map(plain)
    .filter(Boolean)
}

function plain(value: string) {
  return value
    .trim()
    .replace(/^stasiun\s+((krl|mrt|lrt)\s+)?/i, "")
    .replace(/\s+station$/i, "")
    .trim()
}

function key(value: string) {
  return plain(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function sameStation(station: Found, name: string) {
  const wanted = [name, ...(extraAliases[name] ?? [])].map(key)
  return names(station.tags).some((value) => wanted.includes(key(value)))
}

function dedupe(items: Found[]) {
  return items.filter((item, index) => items.findIndex((other) => other.key === item.key) === index)
}

function aliasesOf(name: string, tags: Tags, extra: readonly string[]) {
  const seen = new Set([name.toLowerCase()])
  return [name, ...names(tags), ...extra.map(plain)]
    .flatMap((base) => [base, `Stasiun ${base}`])
    .filter((alias) => {
      if (seen.has(alias.toLowerCase())) return false
      seen.add(alias.toLowerCase())
      return true
    })
}
