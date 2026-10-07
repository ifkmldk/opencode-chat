export * as MapsAccess from "./station-access.js"

import { Effect } from "effect"
import { Geo } from "./geo.js"
import { MapsOsm } from "./osm.js"
import type { Stations } from "./stations.js"
import { MapsTransit } from "./transit-buffer.js"

// fork: the bundled station node sits on the tracks, and OSRM snapped it to the far side of fences and rails (Palmerah →
// Kompas Gramedia: 305 m straight, 2.9 km "walk"). Walks now start from where people leave the station: OSM entrances,
// the station building or area outline, and the platform ends, and the shortest walk over those points counts.

export type Kind = "entrance" | "building" | "platform" | "node"

export type AccessPoint = Geo.Point & { readonly kind: Kind }

export type StationWalk = MapsTransit.Walk & {
  /** Which access point the walk starts at. */
  readonly from: Kind
  readonly start: Geo.Point
  /** Straight line from that access point to the destination. */
  readonly straight: number
  /** MapsTransit.walkingNote for this walk: set when OSRM's route is still unusable. */
  readonly note?: string
}

// Entrances and outlines barely change; a month keeps them without bundling them into stations-data.ts.
const TTL = 30 * 24 * 60 * 60 * 1000
const CHUNK = 20
const MAX_POINTS = 10

/** Access points per station id, from cache or one Overpass request per 20 uncached stations; the node when it fails. */
export async function accessPoints(stations: readonly Stations.Station[]) {
  const known = await Promise.all(
    stations.map(async (station) => {
      const cached = await MapsOsm.cache.get<AccessPoint[]>("station-access", station.id, TTL)
      return [station, cached?.fresh ? cached.value : undefined] as const
    }),
  )
  const missing = known.flatMap((entry) => (entry[1] ? [] : [entry[0]]))
  const fetched = await Promise.all(
    Array.from({ length: Math.ceil(missing.length / CHUNK) }, (_, index) => missing.slice(index * CHUNK, (index + 1) * CHUNK)).map(
      (part) =>
        MapsOsm.overpassRaw(accessQuery(part), { timeoutMs: 40_000, ttlMs: TTL }).then(
          (answer) => {
            const found = pointsOf(answer.elements, part)
            found.forEach((points, id) => MapsOsm.cache.set("station-access", id, points))
            return [...found]
          },
          () => part.map((station) => [station.id, [nodePoint(station)]] as const),
        ),
    ),
  )
  const result = new Map<string, readonly AccessPoint[]>(fetched.flat())
  known.forEach((entry) => {
    if (entry[1]) result.set(entry[0].id, entry[1])
  })
  return result
}

/**
 * Walking from each station to each destination, as the shortest OSRM foot walk over the station's access points.
 * `walking` defaults to MapsTransit.walking (tests pass their own). A pair without any routed walk is undefined.
 */
export const fromStations = Effect.fn("MapsAccess.fromStations")(function* (
  pairs: readonly { readonly station: Stations.Station; readonly to: Geo.Point }[],
  options: {
    readonly walking?: (
      pairs: readonly { from: Geo.Point; to: Geo.Point }[],
    ) => Effect.Effect<readonly (MapsTransit.Walk | undefined)[]>
    readonly points?: ReadonlyMap<string, readonly AccessPoint[]>
  } = {},
) {
  if (!pairs.length) return [] as (StationWalk | undefined)[]
  const stations = [...new Map(pairs.map((pair) => [pair.station.id, pair.station])).values()]
  const points = options.points ?? (yield* Effect.promise(() => accessPoints(stations)))
  // Grouped by station so each OSRM table holds one station's points against many destinations.
  const expanded = pairs
    .flatMap((pair, index) =>
      (points.get(pair.station.id) ?? [nodePoint(pair.station)]).map((point) => ({ index, station: pair.station.id, from: point, to: pair.to })),
    )
    .toSorted((a, b) => a.station.localeCompare(b.station))
  const walks = yield* (options.walking ?? MapsTransit.walking)(expanded.map((entry) => ({ from: entry.from, to: entry.to })))
  const routed = expanded.flatMap((entry, position) => {
    const walk = walks[position]
    if (!walk) return []
    const straight = Math.round(Geo.inverse(entry.from, entry.to).meters)
    const note = MapsTransit.walkingNote(straight, walk)
    return [{ index: entry.index, walk: { ...walk, from: entry.from.kind, start: { latitude: entry.from.latitude, longitude: entry.from.longitude }, straight, ...(note ? { note } : {}) } }]
  })
  const grouped = Map.groupBy(routed, (entry) => entry.index)
  return pairs.map((_, index): StationWalk | undefined => {
    const found = grouped.get(index) ?? []
    // A usable route beats a shorter one OSRM snapped somewhere odd.
    const usable = found.filter((entry) => !entry.walk.note)
    return (usable.length ? usable : found).toSorted((a, b) => a.walk.meters - b.walk.meters)[0]?.walk
  })
})

export function accessQuery(stations: readonly Stations.Station[]) {
  const ids = stations.flatMap((station) => station.id.match(/^osm:node\/(\d+)$/)?.[1] ?? [])
  return `[out:json][timeout:40];node(id:${ids.join(",")})->.c;(node(around.c:250)[railway~"^(train_station_entrance|subway_entrance)$"];node(around.c:250)[entrance];nwr(around.c:150)[railway=platform];wr(around.c:120)[public_transport=station];wr(around.c:120)[railway=station];wr(around.c:120)[building=train_station];);out tags geom;`
}

/** Raw Overpass elements → up to MAX_POINTS access points per station (entrances first), the node always included. */
export function pointsOf(elements: readonly Record<string, unknown>[], stations: readonly Stations.Station[]) {
  const parsed = elements.flatMap((element): { kind: Exclude<Kind, "node">; points: Geo.Point[]; tags: Record<string, string> }[] => {
    const tags = (element.tags ?? {}) as Record<string, string>
    const geometry = [
      ...((element.geometry as { lat: number; lon: number }[] | undefined) ?? []),
      ...((element.members as { geometry?: { lat: number; lon: number }[] }[] | undefined) ?? []).flatMap((member) => member.geometry ?? []),
    ].map((point) => ({ latitude: point.lat, longitude: point.lon }))
    const node =
      typeof element.lat === "number" && typeof element.lon === "number"
        ? [{ latitude: element.lat, longitude: element.lon }]
        : []
    if (tags.railway === "platform" || tags.public_transport === "platform")
      return [{ kind: "platform", points: geometry.length > 1 ? [geometry[0]!, geometry.at(-1)!] : node, tags }]
    if (element.type === "node") return [{ kind: "entrance", points: node, tags }]
    return [{ kind: "building", points: geometry.length ? geometry : node, tags }]
  })
  const outlines = parsed.filter((item) => item.kind === "building").flatMap((item) => item.points)
  return new Map(
    stations.map((station) => {
      const own = (item: (typeof parsed)[number]) =>
        item.points.length > 0 && Geo.nearestCentre(item.points[0]!, stations)?.centre.id === station.id
      // A bare entrance=* counts only on the station building's outline; a dedicated station entrance always counts.
      const entrances = parsed
        .filter((item) => item.kind === "entrance" && own(item))
        .filter(
          (item) =>
            /entrance$/.test(item.tags.railway ?? "") ||
            outlines.some((point) => Geo.inverse(point, item.points[0]!).meters <= 15),
        )
        .flatMap((item) => item.points)
      const building = spread(parsed.filter((item) => item.kind === "building" && own(item)).flatMap((item) => item.points), 6)
      const platforms = parsed.filter((item) => item.kind === "platform" && own(item)).flatMap((item) => item.points)
      const points = [
        ...entrances.map((point) => ({ ...point, kind: "entrance" as const })),
        ...building.map((point) => ({ ...point, kind: "building" as const })),
        ...platforms.map((point) => ({ ...point, kind: "platform" as const })),
      ]
      const unique = [...new Map(points.map((point) => [`${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`, point])).values()]
      return [station.id, [...unique.slice(0, MAX_POINTS - 1), nodePoint(station)]] as const
    }),
  )
}

/** At most `count` points spread evenly along an outline. */
function spread(points: readonly Geo.Point[], count: number) {
  if (points.length <= count) return points
  return Array.from({ length: count }, (_, index) => points[Math.floor((index * points.length) / count)]!)
}

function nodePoint(station: Stations.Station): AccessPoint {
  return { latitude: station.latitude, longitude: station.longitude, kind: "node" }
}
