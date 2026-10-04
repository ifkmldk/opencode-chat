export * as MapsTool from "./maps.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { KV } from "../../kv.js"
import { Geo } from "../../maps/geo.js"
import { GeoStats } from "../../maps/stats.js"
import { MapsEnrich } from "../../maps/enrich.js"
import { MapsLinks } from "../../maps/links.js"
import { MapsOsm } from "../../maps/osm.js"
import { MapsSearch } from "../../maps/search.js"
import { Permission } from "../../permission.js"

// fork: OSM-only (Google/Gemini removed per user decision — no key, never billed).
// Places: OpenStreetMap (+Wikimedia photos, OSM tags). Ratings/reviews/prices
// only when scraped with attribution, else unknown. Keyless Google Maps URLs
// (links.ts) open the real app/website, no API key. See core/src/maps/*.

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const Coordinates = Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number })

const SearchInput = Schema.Struct({
  query: Text(500),
  near: Schema.optional(Text(300)).annotate({ description: 'Place name, address or "lat,lng" to search around' }),
  limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10 }))),
  open_now: Schema.optional(Schema.Boolean),
  anchor: Schema.optional(Text(300)).annotate({ description: "Anchor place/address — results are measured + filtered around it" }),
  radius_m: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 50, maximum: 100000 }))).annotate({ description: "Hard radius filter in meters around the anchor/near point" }),
})
const AskInput = Schema.Struct({
  question: Text(1000),
  near: Schema.optional(Text(300)),
})
const Mode = Schema.Literals(["driving", "walking", "cycling", "transit"] as const)
const RouteInput = Schema.Struct({
  origin: Text(500),
  destination: Text(500),
  stops: Schema.optional(Schema.Array(Text(500)).check(Schema.isMaxLength(8))),
  mode: Schema.optional(Mode),
  optimize_stops: Schema.optional(Schema.Boolean),
})
const MatrixInput = Schema.Struct({
  origins: Schema.Array(Text(300)).check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  destinations: Schema.optional(Schema.Array(Text(300)).check(Schema.isMinLength(1), Schema.isMaxLength(25))),
  mode: Schema.optional(Schema.Literals(["driving", "walking", "cycling"] as const)),
})
const PoiInput = Schema.Struct({
  near: Text(300),
  radius_m: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 50, maximum: 5000 }))),
  tags: Schema.Array(Text(80)).check(Schema.isMinLength(1), Schema.isMaxLength(10)).annotate({
    description: 'OSM tags such as "amenity=hospital", "shop=convenience", "railway=station", "highway=bus_stop"',
  }),
  limit: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})
const PointInput = Schema.Struct({
  latitude: Schema.Number,
  longitude: Schema.Number,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Number).annotate({ description: "Attribute for morans_i / hotspots / classify" }),
  weight: Schema.optional(Schema.Number).annotate({ description: "Weight for centrography" }),
})
const GeoInput = Schema.Struct({
  operation: Schema.Literals([
    "distance",
    "distance_matrix",
    "nearest",
    "within",
    "buffer",
    "area",
    "centroid",
    "bbox",
    "convex_hull",
    "cluster",
    "project",
    "polyline",
    "rank",
    "classify",
    "morans_i",
    "hotspots",
    "nearest_neighbor_index",
    "centrography",
  ] as const),
  points: Schema.optional(Schema.Array(PointInput).check(Schema.isMaxLength(500))),
  origin: Schema.optional(Coordinates),
  radius_m: Schema.optional(Schema.Number),
  k: Schema.optional(Schema.Number),
  ring: Schema.optional(Schema.Array(Coordinates).check(Schema.isMaxLength(2000))),
  polyline: Schema.optional(Schema.String),
  precision: Schema.optional(Schema.Literals([5, 6] as const)),
  eps_m: Schema.optional(Schema.Number),
  values: Schema.optional(Schema.Array(Schema.Number).check(Schema.isMaxLength(5000))).annotate({
    description: "Numbers to classify (or give points with value)",
  }),
  method: Schema.optional(Schema.Literals(GeoStats.CLASS_METHODS)).annotate({
    description: "classify method; omit to compare all and get the recommended one",
  }),
  classes: Schema.optional(Schema.Number),
  distance_m: Schema.optional(Schema.Number).annotate({
    description: "Distance band for morans_i / hotspots weights (default: k nearest neighbours)",
  }),
  area_m2: Schema.optional(Schema.Number),
  min_points: Schema.optional(Schema.Number),
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optional(Schema.String),
        values: Schema.Record(Schema.String, Schema.Number),
      }),
    ).check(Schema.isMaxLength(200)),
  ),
  criteria: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        weight: Schema.Number,
        better: Schema.Literals(["lower", "higher"] as const),
      }),
    ).check(Schema.isMaxLength(20)),
  ),
})
const ShowInput = Schema.Struct({
  title: Schema.optional(Text(200)),
  places: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Text(200),
        latitude: Schema.Number,
        longitude: Schema.Number,
        id: Schema.optional(Schema.String),
        label: Schema.optional(Schema.String),
        rating: Schema.optional(Schema.Number),
        category: Schema.optional(Schema.String),
        url: Schema.optional(Schema.String),
      }),
    ).check(Schema.isMaxLength(50)),
  ),
  route: Schema.optional(
    Schema.Struct({
      geometry: Schema.optional(Schema.String),
      precision: Schema.optional(Schema.Literals([5, 6] as const)),
      mode: Schema.optional(Schema.String),
      label: Schema.optional(Schema.String),
      googleMapsUrl: Schema.optional(Schema.String),
    }),
  ),
  areas: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        ring: Schema.Array(Coordinates).check(Schema.isMaxLength(500)),
      }),
    ).check(Schema.isMaxLength(10)),
  ),
})

const Place = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  address: Schema.optional(Schema.String),
  latitude: Schema.optional(Schema.Number),
  longitude: Schema.optional(Schema.Number),
  location: Schema.optional(Schema.Literals(["accurate", "approximate"] as const)),
  category: Schema.optional(Schema.String),
  rating: Schema.optional(Schema.Number),
  ratingCount: Schema.optional(Schema.Number),
  ratingSource: Schema.optional(Schema.String),
  priceLevel: Schema.optional(Schema.String),
  priceSource: Schema.optional(Schema.String),
  openNow: Schema.optional(Schema.Boolean),
  hoursToday: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  stars: Schema.optional(Schema.Number),
  phone: Schema.optional(Schema.String),
  website: Schema.optional(Schema.String),
  cuisine: Schema.optional(Schema.String),
  photoUrl: Schema.optional(Schema.String),
  photoCredit: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  googleMapsUrl: Schema.optional(Schema.String),
  distanceM: Schema.optional(Schema.Number),
  source: Schema.Literals(["openstreetmap", "scraped"] as const),
})
const SearchOutput = Schema.Struct({
  provider: Schema.String,
  query: Schema.String,
  places: Schema.Array(Place),
  notice: Schema.optional(Schema.String),
  attribution: Schema.String,
})
// Outputs are plain JSON objects built below; the registry stores them as-is.
const Json = Schema.Unknown

export const Plugin = {
  id: "opencode.tool.maps",
  effect: Effect.fn("MapsTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const kv = yield* KV.Service
    void kv

    const guard = (action: string, resources: string[], context: Tool.Context) =>
      permission
        .assert({
          action,
          resources,
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        .pipe(
          Effect.mapError((error) => new ToolFailure({ message: `Maps permission denied: ${error.message}`, error })),
        )

    const maps = MapsSearch.make(ctx, kv)
    const promise = maps.promise
    const resolvePoint = maps.resolvePoint

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "maps_search",
        options: { codemode: false, permission: "maps.search" },
        description: [
          "Search real places (hotels, restaurants, shops, offices, stations...) on OpenStreetMap: category, stars (hotels), opening hours, phone, website, Wikimedia photo, coordinates and a map link. No key, never billed.",
          'Ratings/reviews/prices are NOT in OSM — they appear only when scraped with attribution, otherwise unknown. Write the query in English with local names, e.g. "budget hotel near AEON Mall BSD City".',
          'For anchor+radius filtering pass anchor (place/address) and radius_m (meters, hard filter, results carry distanceM). Example: anchor "Jl. Sudirman, Bandung", radius_m 3000.',
          "Link each place in your answer as [Name](place:<id>) so the user sees its card.",
        ].join(" "),
        input: SearchInput,
        output: SearchOutput,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.search", [input.query], context)
            const output = yield* maps.places({
              query: input.query,
              near: input.near,
              limit: input.limit,
              openNow: input.open_now,
              anchor: input.anchor,
              ...(input.radius_m !== undefined ? { radiusKm: input.radius_m / 1000 } : {}),
            })
            return {
              output,
              content: JSON.stringify(output),
              metadata: { provider: output.provider, count: output.places.length },
            }
          }),
      })

      editor.add({
        name: "maps_ask",
        options: { codemode: false, permission: "maps.ask" },
        description: [
          "Answer a practical local question from OpenStreetMap data around a place: what stations/stops/POIs are nearby, addresses, opening details from OSM tags, plus a keyless Google Maps link for live transit.",
          "For KRL/TransJakarta/MRT lines and transfers, combine maps_poi (railway=station) with the directions link — no key needed.",
        ].join(" "),
        input: AskInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.ask", [input.question], context)
            const near = input.near
              ? yield* resolvePoint(input.near).pipe(Effect.orElseSucceed(() => undefined))
              : undefined
            const center = near ?? (yield* resolvePoint(input.question).pipe(Effect.orElseSucceed(() => undefined)))
            if (!center)
              return yield* new ToolFailure({
                message: "maps_ask needs a place to answer about — pass near or a question naming a place.",
              })
            const stations = yield* promise("OpenStreetMap POIs", () =>
              MapsOsm.poi({ center, radiusMeters: 2000, tags: ["railway=station", "highway=bus_stop"], limit: 50 }),
            )
            const output = {
              provider: "openstreetmap",
              answer: `Nearby stations/stops around ${center.name}: ${stations.map((s) => s.name).join(", ") || "none found"}. Open the directions link for live transit.`,
              stations: stations.map((s) => ({ name: s.name, latitude: s.latitude, longitude: s.longitude, tag: s.tag })),
              directionsUrl: MapsLinks.directions({ destination: center, mode: "transit" }),
              attribution: "© OpenStreetMap contributors",
            }
            return {
              output,
              content: JSON.stringify(output),
              metadata: { provider: "openstreetmap", sources: stations.length },
            }
          }),
      })

      editor.add({
        name: "maps_route",
        options: { codemode: false, permission: "maps.route" },
        description: [
          "Plan a route between places (optionally through stops, with the best stop order) and get distance, duration, the route line and a Google Maps link that opens the live best route.",
          "driving/walking/cycling are computed with OpenStreetMap routing (no live traffic). For transit (KRL, TransJakarta, MRT) it returns the Google Maps link; also call maps_ask for the lines and transfers.",
        ].join(" "),
        input: RouteInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.route", [input.origin, input.destination, ...(input.stops ?? [])], context)
            const mode = input.mode ?? "driving"
            const origin = yield* resolvePoint(input.origin)
            const destination = yield* resolvePoint(input.destination)
            const stops = yield* Effect.forEach(input.stops ?? [], resolvePoint)
            const googleMode = mode === "cycling" ? "bicycling" : mode
            if (mode === "transit") {
              const output = {
                provider: "google-maps-link",
                mode,
                origin,
                destination,
                stops,
                googleMapsUrl: MapsLinks.directions({ origin, destination, waypoints: stops, mode: "transit" }),
                notice:
                  "Free in-app transit routing is not available. The Google Maps link opens the live KRL/TransJakarta route; call maps_ask for the lines and transfers.",
              }
              return { output, content: JSON.stringify(output), metadata: { provider: output.provider } }
            }
            const profile = mode === "walking" ? "foot" : mode === "cycling" ? "bike" : "car"
            const order =
              input.optimize_stops && stops.length > 1
                ? yield* promise("OpenStreetMap routing", () => MapsOsm.trip([origin, ...stops, destination], profile))
                : undefined
            const orderedStops = order ? order.slice(1, -1).map((index) => stops[index - 1]!) : stops
            const route = yield* promise("OpenStreetMap routing", () =>
              MapsOsm.route([origin, ...orderedStops, destination], profile),
            )
            const output = {
              provider: "osrm",
              mode,
              origin,
              destination,
              stops: orderedStops,
              ...(order ? { optimizedOrder: orderedStops.map((stop) => stop.name) } : {}),
              distanceMeters: Math.round(route.distanceMeters),
              durationSeconds: Math.round(route.durationSeconds),
              geometry: route.geometry,
              precision: 6,
              legs: route.legs,
              googleMapsUrl: MapsLinks.directions({ origin, destination, waypoints: orderedStops, mode: googleMode }),
              attribution: "© OpenStreetMap contributors, routing by FOSSGIS OSRM",
            }
            return {
              output,
              content: JSON.stringify(output),
              metadata: {
                provider: "osrm",
                distanceMeters: output.distanceMeters,
                durationSeconds: output.durationSeconds,
              },
            }
          }),
      })

      editor.add({
        name: "maps_matrix",
        options: { codemode: false, permission: "maps.matrix" },
        description:
          "Travel-time and distance matrix between places over the real road network (OpenStreetMap routing, no live traffic). Use it to decide which option is nearest by travel time, not straight-line distance.",
        input: MatrixInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.matrix", [...input.origins, ...(input.destinations ?? [])], context)
            const mode = input.mode ?? "driving"
            const origins = yield* Effect.forEach(input.origins, resolvePoint)
            const destinations = input.destinations ? yield* Effect.forEach(input.destinations, resolvePoint) : origins
            const points = input.destinations ? [...origins, ...destinations] : origins
            const table = yield* promise("OpenStreetMap routing", () =>
              MapsOsm.table(points, mode === "walking" ? "foot" : mode === "cycling" ? "bike" : "car", {
                sources: origins.map((_, index) => index),
                destinations: input.destinations
                  ? destinations.map((_, index) => origins.length + index)
                  : origins.map((_, index) => index),
              }),
            )
            const output = {
              provider: "osrm",
              mode,
              origins,
              destinations,
              durationsSeconds: table.durations.map((row) =>
                row.map((cell) => (cell === null ? null : Math.round(cell))),
              ),
              distancesMeters: table.distances.map((row) =>
                row.map((cell) => (cell === null ? null : Math.round(cell))),
              ),
              attribution: "© OpenStreetMap contributors, routing by FOSSGIS OSRM",
            }
            return { output, content: JSON.stringify(output), metadata: { provider: "osrm" } }
          }),
      })

      editor.add({
        name: "maps_poi",
        options: { codemode: false, permission: "maps.poi" },
        description:
          "Count and list OpenStreetMap features (by OSM tag) around a place, sorted by distance: stations, bus stops, hospitals, minimarkets, schools... Use it for spatial analysis such as accessibility and density.",
        input: PoiInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.poi", [input.near, ...input.tags], context)
            const center = yield* resolvePoint(input.near)
            const radiusMeters = input.radius_m ?? 1000
            const items = yield* promise("OpenStreetMap POIs", () =>
              MapsOsm.poi({ center, radiusMeters, tags: input.tags, limit: 500 }),
            )
            const counts = Object.fromEntries(
              input.tags.map((tag) => [tag, items.filter((item) => item.tag === tag).length]),
            )
            const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000
            const output = {
              provider: "overpass",
              center,
              radiusMeters,
              counts,
              densityPerKm2: Object.fromEntries(
                Object.entries(counts).map(([tag, count]) => [tag, Math.round((count / areaKm2) * 100) / 100]),
              ),
              capped: items.length >= 500,
              nearest: yield* Effect.promise(() => poiDetails(items.slice(0, input.limit ?? 50))),
              attribution: "© OpenStreetMap contributors",
            }
            return { output, content: JSON.stringify(output), metadata: { provider: "overpass", count: items.length } }
          }),
      })

      editor.add({
        name: "geo_compute",
        options: { codemode: false, permission: "geo.compute" },
        description: [
          "Exact, local geodesy and spatial analysis (free, no network): distance/bearing and straight-line matrices on the WGS84 ellipsoid (Karney),",
          "nearest-k, within radius, geodesic buffer circles, polygon area/perimeter, centroid, bbox, convex hull, DBSCAN clusters, UTM projection,",
          "encoded polyline length (precision 6 for maps_route geometry), weighted multi-criteria ranking (rank: candidates with values + criteria),",
          "thematic classification that compares Jenks natural breaks, quantile, equal interval, standard deviation and head/tail breaks and recommends the best by goodness of variance fit (classify),",
          "global Moran's I with a permutation test (morans_i), Getis-Ord Gi* hot/cold spots (hotspots), Clark-Evans nearest-neighbour index (nearest_neighbor_index), and weighted mean centre with standard distance (centrography).",
        ].join(" "),
        input: GeoInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("geo.compute", [input.operation], context)
            const output = yield* Effect.try({
              try: () => compute(input),
              catch: (error) =>
                new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
            })
            return { output, content: JSON.stringify(output), metadata: { operation: input.operation } }
          }),
      })

      editor.add({
        name: "map_show",
        options: { codemode: false, permission: "map.show" },
        description:
          "Show the final shortlist on the user's map panel: the places (with coordinates), the chosen route line and any areas. Call it once at the end of an answer about places or routes.",
        input: ShowInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("map.show", [input.title ?? "map"], context)
            const output = {
              ...input,
              shown: { places: input.places?.length ?? 0, areas: input.areas?.length ?? 0, route: !!input.route },
            }
            return { output, content: JSON.stringify(output), metadata: output.shown }
          }),
      })
    })
  }),
}

function compute(input: typeof GeoInput.Type) {
  const points = input.points ?? []
  const need = (count: number) => {
    if (points.length < count) throw new Error(`${input.operation} needs at least ${count} point(s)`)
  }
  const origin = () => {
    if (!input.origin) throw new Error(`${input.operation} needs an origin`)
    return input.origin
  }
  const radius = () => {
    if (input.radius_m === undefined || !(input.radius_m > 0)) throw new Error(`${input.operation} needs radius_m > 0`)
    return input.radius_m
  }
  const label = (point: (typeof points)[number]) => point.name ?? point.id
  const base = { operation: input.operation, method: Geo.method }
  switch (input.operation) {
    case "distance": {
      need(2)
      const result = Geo.inverse(points[0]!, points[1]!)
      return {
        ...base,
        meters: round(result.meters, 3),
        kilometers: round(result.meters / 1000, 3),
        azimuth: round(result.azimuth, 4),
        finalAzimuth: round(result.finalAzimuth, 4),
      }
    }
    case "distance_matrix": {
      need(2)
      return {
        ...base,
        labels: points.map(label),
        meters: points.map((a) => points.map((b) => round(Geo.inverse(a, b).meters, 1))),
        note: "Straight-line (geodesic) distances; use maps_matrix for travel time over roads.",
      }
    }
    case "nearest": {
      need(1)
      return {
        ...base,
        nearest: Geo.nearest(origin(), points, input.k ?? points.length).map((entry) => ({
          ...entry.item,
          meters: round(entry.meters, 1),
        })),
      }
    }
    case "within": {
      need(1)
      const inside = Geo.within(origin(), radius(), points)
      return {
        ...base,
        radiusMeters: radius(),
        count: inside.length,
        items: inside.map((entry) => ({ ...entry.item, meters: round(entry.meters, 1) })),
      }
    }
    case "buffer": {
      const ring = Geo.circle(origin(), radius(), 48).map(roundPoint)
      return { ...base, radiusMeters: radius(), ring, ...areaOf(ring) }
    }
    case "area": {
      if (!input.ring || input.ring.length < 3) throw new Error("area needs a ring of at least 3 points")
      return { ...base, ...areaOf(input.ring) }
    }
    case "centroid": {
      need(1)
      return { ...base, centroid: roundPoint(Geo.centroid(points)) }
    }
    case "bbox": {
      need(1)
      return { ...base, bbox: Geo.bbox(points) }
    }
    case "convex_hull": {
      need(3)
      const hull = Geo.convexHull(points)
      return {
        ...base,
        ring: hull.ring.map(roundPoint),
        squareMeters: round(hull.squareMeters, 1),
        hectares: round(hull.squareMeters / 10_000, 4),
        perimeterMeters: round(hull.perimeterMeters, 1),
        utm: hull.zone ? `UTM ${hull.zone.zone}${hull.zone.hemisphere} (EPSG:${hull.zone.epsg})` : undefined,
      }
    }
    case "cluster": {
      need(1)
      if (!(input.eps_m && input.eps_m > 0)) throw new Error("cluster needs eps_m > 0")
      const clusters = Geo.dbscan(points, input.eps_m, Math.max(1, Math.round(input.min_points ?? 2)))
      return {
        ...base,
        epsMeters: input.eps_m,
        clusters: clusters.map((entry) => ({ ...entry.item, cluster: entry.cluster })),
      }
    }
    case "project": {
      need(1)
      const projected = Geo.project(points)
      return {
        ...base,
        crs: `UTM ${projected.zone.zone}${projected.zone.hemisphere} (EPSG:${projected.zone.epsg})`,
        coordinates: projected.coordinates.map((coordinate, index) => ({
          label: label(points[index]!),
          easting: round(coordinate.easting, 3),
          northing: round(coordinate.northing, 3),
        })),
      }
    }
    case "polyline": {
      if (!input.polyline) throw new Error("polyline needs an encoded polyline")
      const path = Geo.decodePolyline(input.polyline, input.precision ?? 5)
      return {
        ...base,
        points: path.length,
        meters: round(Geo.length(path), 1),
        start: path[0],
        end: path[path.length - 1],
      }
    }
    case "classify": {
      const values = input.values?.length
        ? input.values
        : points.flatMap((point) => (point.value === undefined ? [] : [point.value]))
      return {
        ...base,
        method: "thematic classification",
        ...GeoStats.classify(values, { method: input.method, classes: input.classes }),
      }
    }
    case "morans_i":
      return { ...base, ...GeoStats.moransI(valued(points), { k: input.k, distance: input.distance_m }) }
    case "hotspots": {
      const spots = GeoStats.hotspots(valued(points), { k: input.k, distance: input.distance_m })
      return {
        ...base,
        method: "Getis-Ord Gi* (binary weights incl. self)",
        hot: spots.filter((spot) => spot.spot.startsWith("hot")).length,
        cold: spots.filter((spot) => spot.spot.startsWith("cold")).length,
        spots: spots.map((spot) => ({ ...spot, z: round(spot.z, 3), p: round(spot.p, 4) })),
      }
    }
    case "nearest_neighbor_index":
      need(3)
      return { ...base, ...GeoStats.nearestNeighborIndex(points, input.area_m2) }
    case "centrography": {
      need(1)
      const result = GeoStats.centrography(points)
      return {
        ...base,
        ...result,
        meanCenter: roundPoint(result.meanCenter),
        standardDistanceMeters: round(result.standardDistanceMeters, 1),
      }
    }
    case "rank": {
      if (!input.candidates?.length || !input.criteria?.length) throw new Error("rank needs candidates and criteria")
      return {
        ...base,
        method: "weighted sum of min-max normalised criteria (1 = best, missing = 0)",
        ranking: Geo.rank(input.candidates, input.criteria),
      }
    }
  }
}

/** POIs with their free OSM details, and a photo for the nearest few. */
function poiDetails(items: readonly (Awaited<ReturnType<typeof MapsOsm.poi>>[number])[]) {
  return Promise.all(
    items.map(async ({ tags, ...item }, index) => {
      const facts = MapsEnrich.details(tags)
      const image = index < 6 && item.name ? await MapsEnrich.photo(tags, { name: item.name, latitude: item.latitude, longitude: item.longitude }) : undefined
      return { ...item, ...facts, openingHours: undefined, photoUrl: image?.url, photoCredit: image?.credit }
    }),
  )
}

function valued(points: readonly (typeof PointInput.Type)[]) {
  const items = points.flatMap((point) => (point.value === undefined ? [] : [{ ...point, value: point.value }]))
  if (items.length < points.length) throw new Error("every point needs a numeric value")
  return items
}

function areaOf(ring: readonly Geo.Point[]) {
  const result = Geo.polygon(ring)
  return {
    squareMeters: round(result.squareMeters, 1),
    hectares: round(result.squareMeters / 10_000, 4),
    squareKilometers: round(result.squareMeters / 1_000_000, 6),
    perimeterMeters: round(result.perimeterMeters, 1),
  }
}

function roundPoint(point: Geo.Point) {
  return { latitude: round(point.latitude, 7), longitude: round(point.longitude, 7) }
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const __test = { SearchInput, RouteInput, GeoInput, compute, notices: MapsSearch.notices }
