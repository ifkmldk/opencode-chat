export * as MapsRide from "./transit-ride.js"

import { Effect } from "effect"
import { Geo } from "./geo.js"
import { MapsOsm } from "./osm.js"
import type { Stations } from "./stations.js"
import type { MapsTransit } from "./transit-buffer.js"

// fork: "atau 1x naik transum langsung dari stasiun". An office counts when ONE bus, TransJakarta, Mikrotrans/JakLingko,
// feeder or angkot route (an OSM route relation) stops a short walk from a station entrance and again a short walk from
// the office. Stop order is not checked: relations are often split per direction and some list stops unordered.

export type Stop = Geo.Point & { readonly id: string; readonly name?: string }

export type Route = {
  readonly id: string
  readonly ref?: string
  readonly name?: string
  readonly network?: string
  /** OSM route=*: bus, trolleybus, share_taxi, minibus. */
  readonly mode: string
  readonly stops: readonly Stop[]
}

export type Leg = { readonly meters: number; readonly seconds?: number; readonly approximate: boolean }

export type Ride = {
  readonly route: Omit<Route, "stops">
  readonly station: Stations.Station
  readonly board: Stop
  readonly alight: Stop
  readonly boardWalk: Leg
  readonly alightWalk: Leg
}

export const BOARD_METERS = 400
export const ALIGHT_METERS = 500
// Stations per Overpass request; one request with ten busy stations returns a few hundred routes.
const CHUNK = 10
const TTL = 7 * 24 * 60 * 60 * 1000

/** Bus-like route relations with a stop within ~600 m of the stations, cached a week; failed station groups are named. */
export async function routesNear(stations: readonly Stations.Station[]) {
  const parts = Array.from({ length: Math.ceil(stations.length / CHUNK) }, (_, index) =>
    stations.slice(index * CHUNK, (index + 1) * CHUNK),
  )
  const answers = await Promise.all(
    parts.map((part) =>
      MapsOsm.overpassRaw(routeQuery(part), { timeoutMs: 60_000, ttlMs: TTL }).then(
        (answer) => ({ part, routes: parseRoutes(answer.elements), stale: answer.stale }),
        (error: unknown) => ({ part, routes: [] as Route[], error: error instanceof Error ? error.message : String(error) }),
      ),
    ),
  )
  return {
    routes: [...new Map(answers.flatMap((answer) => answer.routes).map((route) => [route.id, route])).values()],
    failed: answers.flatMap((answer) => ("error" in answer ? answer.part.map((station) => station.name) : [])),
    errors: [...new Set(answers.flatMap((answer) => ("error" in answer && answer.error ? [answer.error] : [])))],
    stale: answers.some((answer) => "stale" in answer && answer.stale),
  }
}

export function routeQuery(stations: readonly Stations.Station[]) {
  const ids = stations.flatMap((station) => station.id.match(/^osm:node\/(\d+)$/)?.[1] ?? [])
  return `[out:json][timeout:60];node(id:${ids.join(",")})->.c;(node(around.c:600)[highway=bus_stop];node(around.c:600)[public_transport~"^(platform|stop_position)$"][!railway][train!=yes];)->.near;rel(bn.near)[type=route][route~"^(bus|trolleybus|share_taxi|minibus)$"]->.r;.r out body;node(r.r)[~"^(highway|public_transport)$"~"^(bus_stop|platform|stop_position)$"];out body qt;`
}

/** Raw Overpass answer (relations with members, then their stop nodes) → routes with stop coordinates. */
export function parseRoutes(elements: readonly Record<string, unknown>[]): Route[] {
  const nodes = new Map(
    elements.flatMap((element) =>
      element.type === "node" && typeof element.lat === "number" && typeof element.lon === "number"
        ? [[Number(element.id), { id: `osm:node/${element.id}`, latitude: element.lat, longitude: element.lon, name: ((element.tags ?? {}) as Record<string, string>).name }] as const]
        : [],
    ),
  )
  return elements.flatMap((element) => {
    if (element.type !== "relation") return []
    const tags = (element.tags ?? {}) as Record<string, string>
    const members = (element.members ?? []) as { type: string; ref: number; role?: string }[]
    const stops = [
      ...new Map(
        members
          .filter((member) => member.type === "node")
          .flatMap((member) => nodes.get(member.ref) ?? [])
          .map((stop) => [stop.id, stop]),
      ).values(),
    ].map((stop) => (stop.name ? stop : { id: stop.id, latitude: stop.latitude, longitude: stop.longitude }))
    if (stops.length < 2) return []
    return [
      {
        id: `osm:relation/${element.id}`,
        ...(tags.ref ? { ref: tags.ref } : {}),
        ...(tags.name ? { name: tags.name } : {}),
        ...(tags.network ? { network: tags.network } : {}),
        mode: tags.route ?? "bus",
        stops,
      },
    ]
  })
}

/**
 * The best one-ride connection from any of the stations to each target, or none. Candidates come from straight lines
 * (boarding stop near the station, alighting stop near the target, same route); the walks at both ends are then
 * measured: from the station's access points (stationWalk) and from the stop to the target (walking). A leg OSRM cannot
 * route sensibly still counts, marked approximate, when its straight line is at most 0.7 × the limit.
 */
export const oneRide = Effect.fn("MapsRide.oneRide")(function* (input: {
  readonly stations: readonly Stations.Station[]
  readonly routes: readonly Route[]
  readonly targets: readonly { readonly key: string; readonly point: Geo.Point }[]
  readonly stationWalk: (
    pairs: readonly { station: Stations.Station; to: Geo.Point }[],
  ) => Effect.Effect<readonly ((MapsTransit.Walk & { note?: string; straight?: number }) | undefined)[]>
  readonly walking: (pairs: readonly { from: Geo.Point; to: Geo.Point }[]) => Effect.Effect<readonly (MapsTransit.Walk | undefined)[]>
  readonly boardMeters?: number
  readonly alightMeters?: number
}) {
  const boardLimit = input.boardMeters ?? BOARD_METERS
  const alightLimit = input.alightMeters ?? ALIGHT_METERS
  // The station node is mid-station; its entrances can be 150 m nearer a stop, so the shortlist is generous.
  const boards = Map.groupBy(
    input.stations.flatMap((station) =>
      input.routes.flatMap((route) => {
        const stop = Geo.nearest(station, route.stops, 1)[0]
        return stop && stop.meters <= boardLimit + 200 ? [{ station, route, stop: stop.item, straight: stop.meters }] : []
      }),
    ),
    (entry) => entry.route.id,
  )
  const candidates = input.targets.flatMap((target) => {
    const options = [...boards].flatMap(([, list]) => {
      const route = list[0]!.route
      const alight = Geo.nearest(target.point, route.stops, 1)[0]
      if (!alight || alight.meters > alightLimit + 100) return []
      const board = list.toSorted((a, b) => a.straight - b.straight)[0]!
      if (board.stop.id === alight.item.id) return []
      return [{ target, route, board, alight: alight.item, alightStraight: alight.meters }]
    })
    // Both directions of a line share a ref; three distinct lines per target are enough to find one that works.
    const best = [...new Map(options.toSorted((a, b) => a.board.straight + a.alightStraight - (b.board.straight + b.alightStraight)).map((option) => [option.route.ref ?? option.route.id, option])).values()]
    return best.slice(0, 3)
  })
  if (!candidates.length) return new Map<string, Ride>()
  const boardPairs = [...new Map(candidates.map((entry) => [`${entry.board.station.id}|${entry.board.stop.id}`, entry.board])).values()]
  const alightPairs = [...new Map(candidates.map((entry) => [`${entry.alight.id}|${entry.target.key}`, entry])).values()]
  const [boardWalks, alightWalks] = yield* Effect.all(
    [
      input.stationWalk(boardPairs.map((entry) => ({ station: entry.station, to: entry.stop }))),
      input.walking(alightPairs.map((entry) => ({ from: entry.alight, to: entry.target.point }))),
    ],
    { concurrency: 2 },
  )
  const boardOf = new Map(boardPairs.map((entry, index) => [`${entry.station.id}|${entry.stop.id}`, leg(boardWalks[index], entry.straight, boardLimit)]))
  const alightOf = new Map(alightPairs.map((entry, index) => [`${entry.alight.id}|${entry.target.key}`, leg(alightWalks[index], entry.alightStraight, alightLimit)]))
  const rides = candidates.flatMap((entry): { key: string; ride: Ride }[] => {
    const boardWalk = boardOf.get(`${entry.board.station.id}|${entry.board.stop.id}`)
    const alightWalk = alightOf.get(`${entry.alight.id}|${entry.target.key}`)
    if (!boardWalk || !alightWalk) return []
    const route = { id: entry.route.id, mode: entry.route.mode, ...(entry.route.ref ? { ref: entry.route.ref } : {}), ...(entry.route.name ? { name: entry.route.name } : {}), ...(entry.route.network ? { network: entry.route.network } : {}) }
    return [{ key: entry.target.key, ride: { route, station: entry.board.station, board: entry.board.stop, alight: entry.alight, boardWalk, alightWalk } }]
  })
  const grouped = Map.groupBy(rides, (entry) => entry.key)
  return new Map(
    [...grouped].map(([key, list]) => [
      key,
      list
        .map((entry) => entry.ride)
        .toSorted(
          (a, b) =>
            Number(a.boardWalk.approximate || a.alightWalk.approximate) - Number(b.boardWalk.approximate || b.alightWalk.approximate) ||
            a.boardWalk.meters + a.alightWalk.meters - (b.boardWalk.meters + b.alightWalk.meters),
        )[0]!,
    ]),
  )
})

/** "1x Transjakarta 1B dari Stasiun Palmerah (naik Stasiun Palmerah, turun Slipi Petamburan; jalan 120 m + 340 m)". */
export function rideText(ride: Ride) {
  const line = [ride.route.network && !ride.route.name?.toLowerCase().startsWith(ride.route.network.toLowerCase()) ? ride.route.network : undefined, ride.route.ref ?? ride.route.name ?? "rute tanpa nama"]
    .filter(Boolean)
    .join(" ")
  const approximate = ride.boardWalk.approximate || ride.alightWalk.approximate ? ", perkiraan" : ""
  return `1x ${line} dari Stasiun ${ride.station.name} (naik ${ride.board.name ?? "halte tanpa nama"}, turun ${ride.alight.name ?? "halte tanpa nama"}; jalan ${ride.boardWalk.meters} m + ${ride.alightWalk.meters} m${approximate})`
}

/** A measured leg within the limit; a missing or odd route counts only by a short straight line. */
function leg(walk: (MapsTransit.Walk & { note?: string; straight?: number }) | undefined, straight: number, limit: number): Leg | undefined {
  // A station walk carries its own straight line, from the access point it starts at.
  const line = walk?.straight ?? straight
  const odd = !walk || walk.note !== undefined || (walk.meters > 400 && walk.meters > line * 2.5)
  if (walk && !odd) return walk.meters <= limit ? { meters: walk.meters, seconds: walk.seconds, approximate: false } : undefined
  return line <= limit * 0.7 ? { meters: Math.round(line), approximate: true } : undefined
}

/**
 * maps_near_transit with access one_transit: features within ALIGHT_METERS of a stop on a route serving the stations
 * (beyond the walking radius), each with its best verified one-ride connection. Stops are searched in groups of 250
 * with a time budget; groups not reached are reported.
 */
export const featuresByRide = Effect.fn("MapsRide.featuresByRide")(function* (input: {
  readonly stations: readonly Stations.Station[]
  readonly selectors: readonly string[]
  readonly name?: string
  /** Feature ids already reachable on foot. */
  readonly exclude: ReadonlySet<string>
  readonly radiusMeters: number
  readonly limit: number
  readonly stationWalk: Parameters<typeof oneRide>[0]["stationWalk"]
  readonly walking: Parameters<typeof oneRide>[0]["walking"]
}) {
  const found = yield* Effect.promise(() => routesNear(input.stations))
  // Stops a walk away from every station; those inside the walking radius are already covered on foot.
  const stops = [
    ...new Map(
      found.routes
        .flatMap((route) => route.stops)
        .filter((stop) => (Geo.nearestCentre(stop, input.stations)?.meters ?? 0) > input.radiusMeters)
        .map((stop) => [stop.id, stop]),
    ).values(),
  ].slice(0, MAX_STOPS)
  const deadline = Date.now() + Number(process.env.OPENCODE_MAPS_RIDE_BUDGET_MS ?? 90_000)
  const groups = Array.from({ length: Math.ceil(stops.length / STOP_CHUNK) }, (_, index) => stops.slice(index * STOP_CHUNK, (index + 1) * STOP_CHUNK))
  const answers = yield* Effect.forEach(
    groups,
    (group) =>
      Effect.promise(() =>
        Date.now() > deadline
          ? Promise.resolve(undefined)
          : MapsOsm.features({ selectors: input.selectors, centers: group, radiusMeters: ALIGHT_METERS, name: input.name, timeout: 40 }).catch(() => undefined),
      ),
    { concurrency: 1 },
  )
  const elements = [
    ...new Map(answers.flatMap((answer) => answer?.items ?? []).filter((item) => !input.exclude.has(item.id)).map((item) => [item.id, item])).values(),
  ]
    .filter((item) => item.name)
    .slice(0, input.limit)
  const rides = yield* oneRide({
    stations: input.stations,
    routes: found.routes,
    targets: elements.map((item) => ({ key: item.id, point: item })),
    stationWalk: input.stationWalk,
    walking: input.walking,
  })
  const missed = answers.filter((answer) => !answer).length
  const notice = [
    found.failed.length ? `Bus/angkot routes could not be loaded near ${found.failed.length} stations (${found.errors.join("; ").slice(0, 160)}).` : "",
    missed ? `${missed} of ${groups.length} stop groups were not searched (Overpass failed or the time budget ran out); call again, answers are cached.` : "",
    stops.length === MAX_STOPS ? `Only the first ${MAX_STOPS} stops were searched; narrow lines or stations for the rest.` : "",
  ].filter(Boolean)
  return {
    routes: found.routes.length,
    stops: stops.length,
    rows: elements.flatMap((item) => {
      const ride = rides.get(item.id)
      return ride ? [{ element: item, ride }] : []
    }),
    ...(notice.length ? { notice: notice.join(" ") } : {}),
  }
})

const STOP_CHUNK = 250
const MAX_STOPS = 2000
