export * as MapsTransit from "./transit-buffer.js"

import { Effect, Result } from "effect"
import { MapsCategory } from "./categories.js"
import { MapsError } from "./error.js"
import { Geo } from "./geo.js"
import { MapsOsm } from "./osm.js"
import { Stations } from "./stations.js"

// fork: "everything within N m of KRL stations" as one Overpass search around the bundled station nodes, instead of
// geocoding stations one by one. Every feature carries its nearest requested station and the straight-line distance;
// walking distances come from the free FOSSGIS OSRM foot profile.

export type Feature = {
  readonly id: string
  readonly name?: string
  /** "office=company", "tourism=hotel", ... */
  readonly category: string
  readonly latitude: number
  readonly longitude: number
  readonly address?: string
  readonly website?: string
  readonly tags: Record<string, string>
  readonly nearest: {
    readonly stationId: string
    readonly station: string
    readonly lines: readonly string[]
    /** Straight line (geodesic) from the station node to the feature. */
    readonly meters: number
  }
}

export type Input = {
  readonly lines?: readonly string[]
  /** Station names ("Tanah Abang", "Stasiun Sudirman"); they replace the line selection. */
  readonly stations?: readonly string[]
  readonly modes?: readonly Stations.Mode[]
  readonly radiusMeters: number
  readonly kind?: MapsCategory.Kind
  /** OSM selectors, see MapsOsm.filter; they replace `kind`. */
  readonly tags?: readonly string[]
  /** Only features whose name (or brand/operator) matches. */
  readonly name?: string
}

export type Walk = { readonly meters: number; readonly seconds: number }

// Stations per Overpass request. All 83 KRL stations in one request take about 10 s on a healthy server; smaller
// chunks keep each request under the mirror timeout when it is busy, and a failed chunk loses only its stations.
const CHUNK = 20
// OSRM servers reject tables above 100 coordinates by default.
const TABLE_SIDE = 50

export const nearStations = Effect.fn("MapsTransit.nearStations")(function* (input: Input) {
  const scope = yield* resolveScope(input)
  const selectors = input.tags?.length ? input.tags : MapsCategory.tags(input.kind ?? "office")
  // One call stays bounded even when Overpass is slow; groups not reached are reported and, as finished groups are
  // cached, a second call only fetches those.
  const deadline = Date.now() + Number(process.env.OPENCODE_MAPS_TRANSIT_BUDGET_MS ?? 150_000)
  const attempt = (parts: readonly (readonly Stations.Station[])[]) =>
    Effect.forEach(
      parts,
      (part) =>
        Effect.suspend(() =>
          Date.now() > deadline
            ? Effect.fail(
                new MapsError({
                  service: "overpass",
                  kind: "unavailable",
                  message: "this call's time budget was used up",
                }),
              )
            : Effect.tryPromise({
                try: () =>
                  MapsOsm.features({
                    selectors,
                    centers: part,
                    radiusMeters: input.radiusMeters,
                    name: input.name,
                    timeout: 30,
                  }),
                catch: mapsError,
              }),
        ).pipe(
          Effect.result,
          Effect.map((answer) => ({ part, answer })),
        ),
      { concurrency: 1 },
    )
  const first = yield* attempt(split(scope.stations, CHUNK))
  // A busy Overpass answers 504 for a while; a failed group is tried once more, in halves, after a pause.
  const again = first
    .filter((entry) => Result.isFailure(entry.answer))
    .flatMap((entry) => split(entry.part, Math.ceil(entry.part.length / 2)))
  const second = again.length ? yield* Effect.sleep("5 seconds").pipe(Effect.andThen(attempt(again))) : []
  const outcomes = [...first.filter((entry) => Result.isSuccess(entry.answer)), ...second]
  const failed = outcomes.flatMap((entry) =>
    Result.isFailure(entry.answer) ? [{ part: entry.part, error: entry.answer.failure }] : [],
  )
  if (failed.length > 0 && failed.length === outcomes.length) return yield* Effect.fail(failed[0]!.error)
  const results = outcomes.flatMap((entry) => (Result.isSuccess(entry.answer) ? [entry.answer.success] : []))
  const features = assign(
    results.flatMap((result) => result.items),
    scope.stations,
    selectors,
    input.radiusMeters,
  )
  const missing = failed.flatMap((entry) => entry.part.map((station) => station.name))
  const notice = [
    ...scope.notes,
    ...(failed.length
      ? [
          `Overpass failed for ${missing.length} of ${scope.stations.length} stations (${missing.join(", ")}): ${[...new Set(failed.map((entry) => entry.error.message))].join("; ")}. Features near them are missing; call again with the same input, answered groups are cached so only these are fetched.`,
        ]
      : []),
    ...(results.some((result) => result.stale)
      ? ["Overpass was unavailable; part of this answer is cached data older than a day."]
      : []),
  ]
  return {
    stations: scope.stations,
    features,
    total: features.length,
    ...(notice.length ? { notice: notice.join(" ") } : {}),
  }
})

/**
 * Walking distance and time for each pair over the OSM path network (FOSSGIS OSRM foot table), batched so one
 * request holds at most 50 origins and 50 destinations. A pair OSRM cannot route, or a failed batch, is undefined.
 */
export const walking = Effect.fn("MapsTransit.walking")(function* (
  pairs: readonly { readonly from: Geo.Point; readonly to: Geo.Point }[],
  options?: { readonly budgetMs?: number },
) {
  const batches = batch(pairs)
  const deadline = Date.now() + (options?.budgetMs ?? Number(process.env.OPENCODE_MAPS_WALK_BUDGET_MS ?? 60_000))
  // A slow or down OSRM would otherwise cost every remaining batch its own timeout; the first failure stops the rest.
  const state = { down: false }
  const tables = yield* Effect.forEach(
    batches,
    (part) =>
      Effect.suspend(() =>
        state.down || Date.now() > deadline
          ? Effect.succeed(undefined)
          : Effect.tryPromise(() => walkTable(part.sources, part.destinations)).pipe(
              Effect.orElseSucceed(() => {
                state.down = true
                return undefined
              }),
            ),
      ),
    { concurrency: 1 },
  )
  const found = new Map(
    batches.flatMap((part, index) =>
      part.pairs.flatMap((entry) => {
        const meters = tables[index]?.distances[entry.source]?.[entry.destination]
        const seconds = tables[index]?.durations[entry.source]?.[entry.destination]
        return typeof meters === "number" && typeof seconds === "number"
          ? [[entry.index, { meters: Math.round(meters), seconds: Math.round(seconds) }] as const]
          : []
      }),
    ),
  )
  return pairs.map((_, index): Walk | undefined => found.get(index))
})

/**
 * Station nodes sit on the tracks and OSRM snaps both ends to the nearest path, so a walk much longer than the
 * straight line usually means a snap to the wrong side of the tracks or a fenced road, not a real detour.
 */
export function walkingNote(straightMeters: number, walk: Walk | undefined) {
  if (!walk) return "no walking route found"
  if (walk.meters > 400 && walk.meters > straightMeters * 2.5)
    return "routing snapped far away (walk is over 2.5x the straight line); check the station entrance"
  return undefined
}

/** OSM elements → features within the radius of their nearest station, deduplicated and nearest first. */
export function assign(
  elements: readonly MapsOsm.Element[],
  stations: readonly Stations.Station[],
  selectors: readonly string[],
  radiusMeters: number,
): Feature[] {
  const unique = [...new Map(elements.map((element) => [element.id, element])).values()]
  return unique
    .flatMap((element) => {
      // Same answer as Stations.nearest restricted to the requested scope, with a fast shortlist.
      const found = Geo.nearestCentre(element, stations)
      if (!found || found.meters > radiusMeters) return []
      return [
        {
          id: element.id,
          name: element.name,
          category: MapsOsm.categoryOf(element.tags, selectors),
          latitude: element.latitude,
          longitude: element.longitude,
          address: MapsOsm.addressOf(element.tags),
          website: websiteOf(element.tags),
          tags: element.tags,
          nearest: {
            stationId: found.centre.id,
            station: found.centre.name,
            lines: found.centre.lines,
            meters: Math.round(found.meters),
          },
        },
      ]
    })
    .toSorted((a, b) => a.nearest.meters - b.nearest.meters || (a.name ?? "~").localeCompare(b.name ?? "~"))
}

/** The website an OSM object links, as an absolute URL. */
export function websiteOf(tags: Record<string, string>) {
  const value = (tags.website ?? tags["contact:website"] ?? tags.url)?.split(";")[0]?.trim()
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value) ? `https://${value}` : undefined
}

function resolveScope(input: Input) {
  if (input.stations?.length) {
    const found = input.stations.map((name) => ({ name, station: Stations.find(name, { modes: input.modes }) }))
    const stations = [
      ...new Map(
        found.flatMap((entry) => (entry.station ? [[entry.station.id, entry.station] as const] : [])),
      ).values(),
    ]
    const missing = found.filter((entry) => !entry.station).map((entry) => entry.name)
    if (!stations.length)
      return Effect.fail(
        new MapsError({
          service: "stations",
          kind: "not_found",
          message: `No KRL/MRT/LRT station matches ${missing.map((name) => `"${name}"`).join(", ")}. Use names such as "Tanah Abang" or "Stasiun Sudirman".`,
        }),
      )
    return Effect.succeed({
      stations,
      notes: [
        ...(missing.length ? [`Unknown stations skipped: ${missing.join(", ")}.`] : []),
        ...(input.lines?.length ? ["lines was ignored because stations were given."] : []),
      ],
    })
  }
  const lines = (input.lines ?? []).map((line) => ({ line, ids: lineIds(line) }))
  const unknown = lines.filter((entry) => !entry.ids.length).map((entry) => entry.line)
  if (unknown.length)
    return Effect.fail(
      new MapsError({
        service: "stations",
        kind: "rejected",
        message: `Unknown line ${unknown.map((line) => `"${line}"`).join(", ")}. Lines: ${Stations.LINES.map((line) => line.id).join(", ")}.`,
      }),
    )
  const ids = [...new Set(lines.flatMap((entry) => entry.ids))]
  const stations = Stations.list({ lines: ids, modes: input.modes })
  if (!stations.length)
    return Effect.fail(
      new MapsError({
        service: "stations",
        kind: "not_found",
        message: `No stations match lines ${ids.join(", ") || "(all)"} with modes ${(input.modes ?? ["krl"]).join(", ")}.`,
      }),
    )
  return Effect.succeed({ stations, notes: [] as string[] })
}

/** "rangkasbitung", "Rangkas Bitung", "KRL Bogor", "mrt" → line ids. */
function lineIds(line: string) {
  const id = line.trim().toLowerCase()
  if (Stations.LINES.some((item) => item.id === id)) return [id]
  const named = Stations.linesFromText(/\b(krl|mrt|lrt|jalur|line)\b/i.test(line) ? line : `jalur ${line}`)
  if (named.length) return named
  return Stations.linesFromText(line)
}

type Batch = {
  readonly sources: Geo.Point[]
  readonly destinations: Geo.Point[]
  readonly sourceIndex: Map<string, number>
  readonly destinationIndex: Map<string, number>
  readonly pairs: { index: number; source: number; destination: number }[]
}

/** Groups pairs, in order, into OSRM tables of at most TABLE_SIDE distinct origins and destinations. */
function batch(pairs: readonly { readonly from: Geo.Point; readonly to: Geo.Point }[]) {
  const key = (point: Geo.Point) => `${point.latitude},${point.longitude}`
  const batches: Batch[] = []
  pairs.forEach((pair, index) => {
    const last = batches.at(-1)
    const fits =
      last !== undefined &&
      (last.sourceIndex.has(key(pair.from)) || last.sources.length < TABLE_SIDE) &&
      (last.destinationIndex.has(key(pair.to)) || last.destinations.length < TABLE_SIDE)
    const current: Batch =
      fits && last
        ? last
        : { sources: [], destinations: [], sourceIndex: new Map(), destinationIndex: new Map(), pairs: [] }
    if (current !== last) batches.push(current)
    const source = current.sourceIndex.get(key(pair.from)) ?? current.sources.push(pair.from) - 1
    current.sourceIndex.set(key(pair.from), source)
    const destination = current.destinationIndex.get(key(pair.to)) ?? current.destinations.push(pair.to) - 1
    current.destinationIndex.set(key(pair.to), destination)
    current.pairs.push({ index, source, destination })
  })
  return batches
}

async function walkTable(sources: readonly Geo.Point[], destinations: readonly Geo.Point[]) {
  const key = JSON.stringify([sources, destinations])
  const cached = await MapsOsm.cache.get<Awaited<ReturnType<typeof MapsOsm.table>>>(
    "osrm-foot",
    key,
    24 * 60 * 60 * 1000,
  )
  if (cached?.fresh) return cached.value
  const table = await MapsOsm.table([...sources, ...destinations], "foot", {
    sources: sources.map((_, index) => index),
    destinations: destinations.map((_, index) => sources.length + index),
  })
  MapsOsm.cache.set("osrm-foot", key, table)
  return table
}

function split<T>(items: readonly T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )
}

function mapsError(error: unknown) {
  if (error instanceof MapsError) return error
  return new MapsError({
    service: "overpass",
    kind: "unavailable",
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}
