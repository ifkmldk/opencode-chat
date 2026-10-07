export * as MapsTool from "./maps.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { KV } from "../../kv.js"
import { MapsCategory } from "../../maps/categories.js"
import { Geo } from "../../maps/geo.js"
import { GeoStats } from "../../maps/stats.js"
import { MapsEnrich } from "../../maps/enrich.js"
import { MapsLinks } from "../../maps/links.js"
import { MapsOsm } from "../../maps/osm.js"
import { MapsSearch } from "../../maps/search.js"
import { Stations } from "../../maps/stations.js"
import { MapsTransit } from "../../maps/transit-buffer.js"
import { MapsAccess } from "../../maps/station-access.js"
import { MapsRide } from "../../maps/transit-ride.js"
import { Permission } from "../../permission.js"

// fork: OSM-only (Google/Gemini removed per user decision — no key, never billed).
// Places: OpenStreetMap (+Wikimedia photos, OSM tags). Ratings/reviews/prices
// only when scraped with attribution, else unknown. Keyless Google Maps URLs
// (links.ts) open the real app/website, no API key. See core/src/maps/*.
// Effect's JSON Schema drops numeric range checks (tool/runtime.ts), so every limit is also written in the
// field description where the model can see it.

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const Range = (minimum: number, maximum: number) => Schema.Number.check(Schema.isBetween({ minimum, maximum }))
// Unknown top-level keys fail with "Expected no excess property" instead of being dropped (a misspelt field used to
// be ignored); points and places may carry extra fields from earlier results, which are dropped as before.
const strict = { parseOptions: { onExcessProperty: "error" as const } }
const lenient = { parseOptions: { onExcessProperty: "ignore" as const } }
const Coordinates = Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number }).annotate(lenient)
const PLACE_REF =
  'a place name, an address, "lat,lng", a station ("Stasiun Cisauk") or a place id from an earlier result ("osm:way/123")'

const SearchInput = Schema.Struct({
  query: Text(500).annotate({
    description:
      'A name or address ("AEON Mall BSD City", "Jl. Pahlawan Seribu, Serpong", "Stasiun Sudirman"), or a category word ("rumah sakit", "hotel", "tempat wisata", "kantor") together with near or anchor. Keep it short; extra words make name search fail.',
  }),
  near: Schema.optional(Text(300)).annotate({ description: `Where to search: ${PLACE_REF}` }),
  limit: Schema.optional(Range(1, 50)).annotate({ description: "Places to return, 1-50 (default 6)" }),
  open_now: Schema.optional(Schema.Boolean).annotate({
    description:
      "Open places first, then those with unknown hours (most OSM places have none); closed places are left out",
  }),
  anchor: Schema.optional(Text(300)).annotate({
    description: `Centre that results are measured from (distanceM) and filtered around: ${PLACE_REF}`,
  }),
  radius_m: Schema.optional(Range(50, 100000)).annotate({
    description:
      "Hard radius around anchor/near in meters, 50-100000. Category searches default to 3000 (widened to 10000 when empty)",
  }),
})
const AskInput = Schema.Struct({
  question: Text(1000),
  near: Schema.optional(Text(300)).annotate({ description: `The place to look around: ${PLACE_REF}` }),
})
const Mode = Schema.Literals(["driving", "walking", "cycling", "transit"] as const)
const RouteInput = Schema.Struct({
  origin: Text(500).annotate({ description: `Start: ${PLACE_REF}` }),
  destination: Text(500).annotate({ description: `End: ${PLACE_REF}` }),
  stops: Schema.optional(Schema.Array(Text(500)).check(Schema.isMaxLength(8))).annotate({
    description: "Up to 8 stops in between, same forms as origin",
  }),
  mode: Schema.optional(Mode).annotate({ description: "driving (default), walking, cycling or transit (link only)" }),
  optimize_stops: Schema.optional(Schema.Boolean).annotate({ description: "Reorder the stops for the shortest trip" }),
})
const MatrixInput = Schema.Struct({
  origins: Schema.Array(Text(300))
    .check(Schema.isMinLength(1), Schema.isMaxLength(25))
    .annotate({
      description: `1-25 origins, each ${PLACE_REF}`,
    }),
  destinations: Schema.optional(Schema.Array(Text(300)).check(Schema.isMinLength(1), Schema.isMaxLength(25))).annotate({
    description: "1-25 destinations (default: the origins), same forms",
  }),
  mode: Schema.optional(Schema.Literals(["driving", "walking", "cycling"] as const)).annotate({
    description: "driving (default), walking or cycling",
  }),
})
const PoiInput = Schema.Struct({
  near: Text(300).annotate({ description: `Centre: ${PLACE_REF}` }),
  radius_m: Schema.optional(Range(50, 5000)).annotate({ description: "Radius in meters, 50-5000 (default 1000)" }),
  tags: Schema.Array(Text(120)).check(Schema.isMinLength(1), Schema.isMaxLength(10)).annotate({
    description:
      '1-10 OSM selectors, OR-ed: "amenity=hospital", "healthcare=hospital", "tourism=hotel|guest_house" (| = alternatives), "office" (any value), "railway=station+network=KAI Commuter" (+ = both)',
  }),
  limit: Schema.optional(Range(1, 500)).annotate({ description: "Features listed, nearest first, 1-500 (default 50)" }),
})
const PointInput = Schema.Struct({
  latitude: Schema.Number,
  longitude: Schema.Number,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Number).annotate({ description: "Attribute for morans_i / hotspots / classify" }),
  weight: Schema.optional(Schema.Number).annotate({ description: "Weight for centrography" }),
}).annotate(lenient)
const GeoInput = Schema.Struct({
  operation: Schema.Literals([
    "distance",
    "distance_matrix",
    "nearest",
    "within",
    "near_any",
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
  points: Schema.optional(Schema.Array(PointInput).check(Schema.isMaxLength(2000))).annotate({
    description: "Points {latitude, longitude, id?, name?, value?, weight?}, at most 2000",
  }),
  origin: Schema.optional(Coordinates).annotate({
    description: "One centre for distance (origin → every point), nearest, within and buffer",
  }),
  centres: Schema.optional(Schema.Array(PointInput).check(Schema.isMaxLength(500))).annotate({
    description: "near_any: the many centres (stations, offices) each point is matched against, at most 500",
  }),
  radius_m: Schema.optional(Schema.Number).annotate({
    description: "Meters, > 0: within / buffer radius; near_any marks points whose nearest centre is within it",
  }),
  k: Schema.optional(Schema.Number).annotate({
    description: "nearest: how many (default all); morans_i/hotspots neighbours",
  }),
  ring: Schema.optional(Schema.Array(Coordinates).check(Schema.isMaxLength(2000))).annotate({
    description: "area: polygon ring of 3-2000 points",
  }),
  polyline: Schema.optional(Schema.String).annotate({ description: "polyline: encoded polyline" }),
  precision: Schema.optional(Schema.Literals([5, 6] as const)).annotate({
    description: "polyline precision; 6 for maps_route geometry (default 5)",
  }),
  eps_m: Schema.optional(Schema.Number).annotate({ description: "cluster: neighbourhood radius in meters, > 0" }),
  values: Schema.optional(Schema.Array(Schema.Number).check(Schema.isMaxLength(5000))).annotate({
    description: "Numbers to classify (or give points with value), at most 5000",
  }),
  method: Schema.optional(Schema.Literals(GeoStats.CLASS_METHODS)).annotate({
    description: "classify method; omit to compare all and get the recommended one",
  }),
  classes: Schema.optional(Schema.Number).annotate({ description: "classify: number of classes" }),
  distance_m: Schema.optional(Schema.Number).annotate({
    description: "Distance band for morans_i / hotspots weights (default: k nearest neighbours)",
  }),
  area_m2: Schema.optional(Schema.Number).annotate({ description: "nearest_neighbor_index: study area in m²" }),
  min_points: Schema.optional(Schema.Number).annotate({
    description: "cluster: minimum points per cluster (default 2)",
  }),
  candidates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optional(Schema.String),
        values: Schema.Record(Schema.String, Schema.Number),
      }).annotate(lenient),
    ).check(Schema.isMaxLength(200)),
  ).annotate({ description: "rank: up to 200 candidates with numeric values per criterion key" }),
  criteria: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        weight: Schema.Number,
        better: Schema.Literals(["lower", "higher"] as const),
      }).annotate(lenient),
    ).check(Schema.isMaxLength(20)),
  ).annotate({ description: "rank: up to 20 criteria {key, weight, better: lower|higher}" }),
}).annotate(strict)
const TransitInput = Schema.Struct({
  lines: Schema.optional(Schema.Array(Text(60)).check(Schema.isMaxLength(8))).annotate({
    description: `Line ids: ${Stations.LINES.map((line) => line.id).join(", ")}. Omit for every KRL line (all ${Stations.list().length} KRL stations).`,
  }),
  stations: Schema.optional(Schema.Array(Text(80)).check(Schema.isMaxLength(150))).annotate({
    description: 'Station names instead of lines, up to 150: "Tanah Abang", "Stasiun Sudirman", "MRT Blok M"',
  }),
  radius_m: Schema.optional(Range(50, 5000)).annotate({
    description: "Straight-line radius around each station in meters, 50-5000 (default 1000)",
  }),
  kind: Schema.optional(Schema.Literals(MapsCategory.KINDS)).annotate({
    description:
      "What to list (default office): office = kantor/perusahaan, hotel = hotel/penginapan, attraction = wisata, hospital = RS, clinic = klinik/puskesmas, mall, restaurant, cafe, school, university, mosque, church, pharmacy, bank, atm, park, station, bus_stop, supermarket, gas_station, parking, coworking",
  }),
  tags: Schema.optional(Schema.Array(Text(120)).check(Schema.isMaxLength(10))).annotate({
    description:
      'OSM selectors instead of kind, up to 10, OR-ed: "office=company", "tourism=hotel|guest_house", "amenity=place_of_worship+religion=muslim" (+ = both)',
  }),
  name: Schema.optional(Text(100)).annotate({
    description: 'Only features whose name, brand or operator contains these words ("Astra", "Kompas Gramedia")',
  }),
  walking: Schema.optional(Schema.Boolean).annotate({
    description:
      "Walking meters and minutes from the station for every returned feature (OSRM foot, from the station's best entrance/outline point). Default: on when at most 200 are returned",
  }),
  access: Schema.optional(Schema.Literals(["walk", "one_transit"] as const)).annotate({
    description:
      'walk (default): within radius_m of the stations. one_transit also lists features reachable by ONE direct bus/TransJakarta/Mikrotrans/angkot ride from a station (OSM route relations: stop within 400 m walk of a station entrance and within 500 m walk of the feature), in rideFeatures with route, stops and walks.',
  }),
  limit: Schema.optional(Range(1, 2000)).annotate({
    description:
      "Features returned, named ones first and nearest first, 1-2000 (default 500); total counts every match",
  }),
}).annotate(strict)
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
  category: Schema.optional(Schema.String),
  center: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String), latitude: Schema.Number, longitude: Schema.Number }),
  ),
  radiusMeters: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
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
    const resolvePoint = (text: string) => maps.resolvePoint(text)

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "maps_search",
        options: { codemode: false, permission: "maps.search" },
        description: [
          "Find real places on OpenStreetMap (free, no key): category, stars (hotels), opening hours, phone, website, Wikimedia photo, coordinates and a map link.",
          'Two kinds of query. A name or address ("AEON Mall BSD City", "Menara Astra", "Jl. Pahlawan Seribu Serpong", "Stasiun Cisauk") is looked up by name; keep it short, extra words make it fail.',
          'A category word ("rumah sakit", "RS", "klinik", "hotel", "penginapan", "tempat wisata", "kantor", "mal", "restoran", "kafe", "masjid", "apotek", "SPBU") with near or anchor (or "… dekat X" in the query) lists every place of that OSM category around the centre, nearest first, within radius_m (default 3000 m).',
          "Results within a radius carry distanceM (straight line). For things near KRL/MRT/LRT stations use maps_near_transit; for raw OSM tags around one point use maps_poi.",
          "Ratings/reviews/prices are NOT in OSM; they are unknown unless scraped with attribution. Link each place in your answer as [Name](place:<id>) so the user sees its card.",
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
          "List the KRL/MRT/LRT stations (bundled OSM station list, with lines and straight-line meters) and the bus stops nearest one place, plus a keyless Google Maps transit link.",
          "It does not plan routes or transfers; for those give the Google Maps link from maps_route with mode transit.",
        ].join(" "),
        input: AskInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.ask", [input.question], context)
            const near = input.near
              ? yield* resolvePoint(input.near).pipe(Effect.orElseSucceed(() => undefined))
              : undefined
            // "stasiun terdekat dari Menara Astra?" names its place after "dari"/"dekat"/"near".
            const named = input.near ? undefined : MapsCategory.parse(input.question).place
            const center =
              near ??
              (named ? yield* resolvePoint(named).pipe(Effect.orElseSucceed(() => undefined)) : undefined) ??
              (yield* resolvePoint(input.question).pipe(Effect.orElseSucceed(() => undefined)))
            if (!center)
              return yield* new ToolFailure({
                message: "maps_ask needs a place to answer about — pass near or a question naming a place.",
              })
            // Rail stations come from the bundled list so dozens of nearby bus stops can never crowd them out.
            const stations = Stations.nearest(center, { modes: ["krl", "mrt", "lrt"], k: 5 }).map((entry) => ({
              id: entry.station.id,
              name: entry.station.name,
              mode: entry.station.mode,
              lines: entry.station.lines,
              latitude: entry.station.latitude,
              longitude: entry.station.longitude,
              meters: Math.round(entry.meters),
            }))
            const stops = yield* Effect.tryPromise(() =>
              MapsOsm.poi({ center, radiusMeters: 800, tags: ["highway=bus_stop", "amenity=bus_station"], limit: 8 }),
            ).pipe(Effect.orElseSucceed(() => undefined))
            const busStops = (stops ?? []).map((stop) => ({
              id: stop.id,
              name: stop.name ?? "(unnamed stop)",
              latitude: stop.latitude,
              longitude: stop.longitude,
              meters: stop.meters,
            }))
            MapsSearch.remember([...stations, ...busStops])
            const output = {
              provider: "openstreetmap",
              center,
              answer: `Nearest stations to ${center.name}: ${stations.map((station) => `${station.name} (${station.mode.toUpperCase()} ${station.lines.join("/")}, ${station.meters} m)`).join(", ")}. Bus stops within 800 m: ${busStops.map((stop) => `${stop.name} (${stop.meters} m)`).join(", ") || (stops ? "none in OSM" : "unknown (Overpass unavailable)")}. Distances are straight lines; open the directions link for live transit.`,
              stations,
              busStops,
              directionsUrl: MapsLinks.directions({ destination: center, mode: "transit" }),
              attribution: "© OpenStreetMap contributors",
            }
            return {
              output,
              content: JSON.stringify(output),
              metadata: { provider: "openstreetmap", sources: stations.length + busStops.length },
            }
          }),
      })

      editor.add({
        name: "maps_route",
        options: { codemode: false, permission: "maps.route" },
        description: [
          "Plan a route between places (optionally through stops, with the best stop order) and get distance, duration, the route line and a Google Maps link that opens the live best route.",
          'Places may be "lat,lng" or a place id from an earlier maps result ("osm:way/562554943") so the exact place is used without geocoding its name again; stations by name ("Stasiun Serpong").',
          "driving/walking/cycling are computed with OpenStreetMap routing (no live traffic). For transit (KRL, TransJakarta, MRT) it only returns the Google Maps link.",
        ].join(" "),
        input: RouteInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.route", [input.origin, input.destination, ...(input.stops ?? [])], context)
            const mode = input.mode ?? "driving"
            const origin = yield* resolvePoint(input.origin)
            const destination = yield* resolvePoint(input.destination)
            const stops = yield* Effect.forEach(input.stops ?? [], (stop) => resolvePoint(stop))
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
                  "Free in-app transit routing is not available. The Google Maps link opens the live KRL/TransJakarta route with its lines and transfers.",
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
        description: [
          "Travel-time and distance matrix between places over the real road and path network (OpenStreetMap routing, no live traffic); mode walking gives walking meters.",
          'Use it to decide which option is nearest by travel time, not straight-line distance. Places may be "lat,lng" or place ids from earlier maps results ("osm:node/123"), which are used as-is without geocoding again.',
        ].join(" "),
        input: MatrixInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.matrix", [...input.origins, ...(input.destinations ?? [])], context)
            const mode = input.mode ?? "driving"
            const origins = yield* Effect.forEach(input.origins, (origin) => resolvePoint(origin))
            const destinations = input.destinations
              ? yield* Effect.forEach(input.destinations, (destination) => resolvePoint(destination))
              : origins
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
        description: [
          "List and count every OpenStreetMap feature with the given tags around one place, nearest first: the way to list a category (hotels, hospitals, offices, attractions, minimarkets, schools...) around one point.",
          'Tags: "tourism=hotel|guest_house|hostel" (| = alternatives), "amenity=hospital", "healthcare=hospital", "amenity=clinic", "tourism=attraction|museum|theme_park|zoo", "leisure=park", "office" (any office), "building=office", "shop=mall", "railway=station+network=KAI Commuter" (+ = both).',
          "Each feature has its straight-line meters, address (addr:*), website, office/brand/operator tags and OSM id. counts and total cover every match, also beyond limit. For many stations at once use maps_near_transit.",
        ].join(" "),
        input: PoiInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* guard("maps.poi", [input.near, ...input.tags], context)
            const center = yield* resolvePoint(input.near)
            const radiusMeters = input.radius_m ?? 1000
            const tags = input.tags.filter((tag) => MapsOsm.filter(tag) !== undefined)
            if (tags.length < input.tags.length)
              return yield* new ToolFailure({
                message: `Invalid OSM tags: ${input.tags.filter((tag) => !tags.includes(tag)).join(", ")}. Use key, key=value, key=a|b, or join filters with +.`,
              })
            const found = yield* promise("OpenStreetMap POIs", () =>
              MapsOsm.features({ selectors: tags, centers: [center], radiusMeters, limit: input.limit ?? 50 }),
            )
            const items = found.items.map((item) => ({
              ...item,
              meters: item.meters ?? 0,
              tag: tags.find((tag) => MapsOsm.matches(item.tags, tag)) ?? tags[0]!,
            }))
            const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000
            // Per-tag counts are exact when every match was fetched; otherwise only the total is.
            const counts = Object.fromEntries(tags.map((tag) => [tag, items.filter((item) => item.tag === tag).length]))
            const nearest = yield* Effect.promise(() => poiDetails(items))
            MapsSearch.remember(nearest)
            const output = {
              provider: "overpass",
              center,
              radiusMeters,
              total: found.total,
              counts,
              ...(found.total > items.length
                ? {
                    countsNote: `counts cover the ${items.length} nearest of ${found.total}; raise limit (max 500) for exact counts`,
                  }
                : {}),
              densityPerKm2: Object.fromEntries(
                Object.entries(counts).map(([tag, count]) => [tag, Math.round((count / areaKm2) * 100) / 100]),
              ),
              totalPerKm2: Math.round((found.total / areaKm2) * 100) / 100,
              capped: found.capped,
              ...(found.stale ? { notice: "Overpass was unavailable; this is cached data older than a day." } : {}),
              nearest,
              attribution: "© OpenStreetMap contributors",
            }
            return { output, content: JSON.stringify(output), metadata: { provider: "overpass", count: found.total } }
          }),
      })

      editor.add({
        name: "maps_near_transit",
        options: { codemode: false, permission: "maps.near_transit" },
        description: [
          "Everything of one kind within a radius of KRL/MRT/LRT stations, in one call: offices/companies, hotels, attractions, hospitals, clinics, malls... near every station of the chosen lines.",
          `Covers all ${Stations.list().length} KRL stations on every line (bogor, cikarang, rangkasbitung, tangerang, tanjung-priok) by default; lines or stations narrow it, and mrt-jakarta, lrt-jabodebek, lrt-jakarta add MRT/LRT.`,
          "Each feature: name, OSM category, address, website, nearest station with its lines, straight-line meters from the station node, and walking meters/minutes (OSRM foot from the station's best entrance, building outline or platform end; a note flags walks that still snapped far away). access one_transit adds rideFeatures reachable by one direct bus/angkot ride.",
          "Limits: radius_m 50-5000 (default 1000), limit 1-2000 (default 150, named features first; perLine/perStation and total count every match, raise limit for the full list); walking routes at most the first 300 rows within 60 s. Data is OpenStreetMap via Overpass, cached for a day; stations are a bundled OSM list.",
          'kind office also lists government, NGO and RW offices; for employers only pass tags ["office=company|it|financial|insurance|consulting|telecommunication|advertising_agency|newspaper|logistics", "building=company"]. Use name to find one company near the stations. Never geocode stations one by one with maps_search.',
        ].join(" "),
        input: TransitInput,
        output: Json,
        execute: (input, context) =>
          Effect.gen(function* () {
            const what = input.tags?.length ? input.tags.join(",") : (input.kind ?? "office")
            yield* guard("maps.near_transit", [what, ...(input.stations ?? input.lines ?? ["krl"])], context)
            const radiusMeters = input.radius_m ?? 1000
            const found = yield* MapsTransit.nearStations({
              lines: input.lines,
              stations: input.stations,
              radiusMeters,
              kind: input.kind,
              tags: input.tags,
              name: input.name,
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `maps_near_transit failed: ${error.message}`, error }),
              ),
            )
            // Named features first: an unnamed office building is rarely useful in a list of companies.
            const ordered = [
              ...found.features.filter((item) => item.name),
              ...found.features.filter((item) => !item.name),
            ]
            const shown = ordered.slice(0, input.limit ?? 150)
            const byId = new Map(found.stations.map((station) => [station.id, station]))
            const walk = input.walking ?? shown.length <= 200
            // fork: OSRM is a shared free server; routing is capped so one call cannot queue dozens of slow tables.
            const walks = walk
              ? yield* MapsAccess.fromStations(
                  shown.slice(0, 300).map((item) => ({ station: byId.get(item.nearest.stationId)!, to: item })),
                )
              : []
            const unrouted = walk ? shown.length - walks.filter((item) => item).length : 0
            const features = shown.map((item, index) => transitRow(item, walk ? walks[index] : undefined, walk))
            MapsSearch.remember(features)
            const ride =
              input.access === "one_transit"
                ? yield* MapsRide.featuresByRide({
                    stations: found.stations,
                    selectors: input.tags?.length ? input.tags : MapsCategory.tags(input.kind ?? "office"),
                    ...(input.name ? { name: input.name } : {}),
                    exclude: new Set(found.features.map((item) => item.id)),
                    radiusMeters,
                    limit: Math.min(input.limit ?? 150, 300),
                    stationWalk: (pairs) => MapsAccess.fromStations(pairs),
                    walking: (pairs) => MapsTransit.walking(pairs),
                  })
                : undefined
            const rideFeatures = (ride?.rows ?? []).map((row) => ({
              id: row.element.id,
              name: row.element.name,
              category: MapsOsm.categoryOf(row.element.tags, input.tags?.length ? input.tags : MapsCategory.tags(input.kind ?? "office")),
              address: MapsOsm.addressOf(row.element.tags),
              website: MapsTransit.websiteOf(row.element.tags),
              latitude: row.element.latitude,
              longitude: row.element.longitude,
              access: MapsRide.rideText(row.ride),
              station: row.ride.station.name,
              route: row.ride.route,
              board: row.ride.board,
              alight: row.ride.alight,
              boardWalkMeters: row.ride.boardWalk.meters,
              alightWalkMeters: row.ride.alightWalk.meters,
              approximate: row.ride.boardWalk.approximate || row.ride.alightWalk.approximate,
            }))
            const output = {
              provider: "openstreetmap",
              what,
              radiusMeters,
              stations: found.stations.length,
              lines: [...new Set(found.stations.flatMap((station) => station.lines))],
              total: found.total,
              named: found.features.filter((item) => item.name).length,
              withWebsite: found.features.filter((item) => item.website).length,
              returned: features.length,
              perLine: count(found.features.flatMap((item) => item.nearest.lines)),
              perStation: count(found.features.map((item) => item.nearest.station)),
              distances:
                "straightMeters: geodesic from the station node (it sits on the tracks); walkingMeters/Minutes: OSRM foot route over OSM paths",
              ...(found.notice || unrouted
                ? {
                    notice: [
                      found.notice,
                      unrouted
                        ? `${unrouted} of ${shown.length} rows have no walking distance (OSRM slow, down, or beyond the 300-row cap); straightMeters still applies.`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" "),
                  }
                : {}),
              features,
              ...(ride
                ? {
                    oneTransit: `${rideFeatures.length} more features reachable by one direct bus/angkot ride (${ride.routes} OSM routes, ${ride.stops} stops searched)${ride.notice ? `; ${ride.notice}` : ""}`,
                    rideFeatures,
                  }
                : {}),
              attribution: "© OpenStreetMap contributors, routing by FOSSGIS OSRM",
            }
            return {
              output,
              content: transitTable(output),
              metadata: { provider: "openstreetmap", count: found.total, returned: features.length },
            }
          }),
      })

      editor.add({
        name: "geo_compute",
        options: { codemode: false, permission: "geo.compute" },
        description: [
          "Exact, local geodesy and spatial analysis (free, no network) on the WGS84 ellipsoid (Karney). Unknown fields are rejected. Operations and what they need:",
          "distance: origin + points → meters from origin to every point (without origin: points[0] to points[1]); distance_matrix: 2+ points;",
          "nearest: origin + points (+ k); within: origin + radius_m + points; near_any: points + centres (+ radius_m) → each point's nearest centre and meters, with within flags and a count (offices vs stations);",
          "buffer: origin + radius_m → circle ring; area: ring; centroid, bbox: points; convex_hull: 3+ points; cluster: points + eps_m (+ min_points, DBSCAN); project: points → UTM;",
          "polyline: encoded line length (precision 6 for maps_route geometry); rank: candidates + criteria (weighted min-max);",
          "classify: values (Jenks, quantile, equal interval, std dev, head/tail; recommends by goodness of variance fit); morans_i, hotspots (Getis-Ord Gi*): 4+ points with value; nearest_neighbor_index: 3+ points (+ area_m2); centrography: points (+ weight).",
          "Limits: points ≤ 2000, centres ≤ 500, ring ≤ 2000, values ≤ 5000, candidates ≤ 200, criteria ≤ 20.",
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
      if (input.origin) {
        need(1)
        const from = input.origin
        return {
          ...base,
          origin: from,
          distances: points.map((point) => {
            const result = Geo.inverse(from, point)
            return {
              ...point,
              meters: round(result.meters, 1),
              kilometers: round(result.meters / 1000, 3),
              azimuth: round(result.azimuth, 2),
            }
          }),
          note: "Straight-line (geodesic) distances from origin; use maps_matrix (mode walking) for walking distance.",
        }
      }
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
    case "near_any": {
      need(1)
      const centres = input.centres ?? []
      if (!centres.length)
        throw new Error("near_any needs centres (the stations or other centres to match points against)")
      if (input.radius_m !== undefined && !(input.radius_m > 0)) throw new Error("near_any radius_m must be > 0")
      const items = Geo.nearAny(points, centres, input.radius_m).map((entry) => ({
        ...entry.item,
        nearest: { ...entry.centre, meters: round(entry.meters, 1) },
        ...(input.radius_m !== undefined ? { within: entry.within } : {}),
      }))
      return {
        ...base,
        centres: centres.length,
        ...(input.radius_m !== undefined
          ? { radiusMeters: input.radius_m, count: items.filter((item) => item.within).length }
          : {}),
        items,
        note: "Straight-line (geodesic) distance to the nearest centre.",
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

/** POIs with their free OSM details (address, website, office/brand tags), and a photo for the nearest few. */
function poiDetails(items: readonly (MapsOsm.Element & { meters: number; tag: string })[]) {
  return Promise.all(
    items.map(async (item, index) => {
      const facts = MapsEnrich.details(item.tags)
      const image =
        index < 6 && item.name
          ? await MapsEnrich.photo(item.tags, { name: item.name, latitude: item.latitude, longitude: item.longitude })
          : undefined
      return {
        id: item.id,
        name: item.name,
        tag: item.tag,
        category: MapsOsm.categoryOf(item.tags, [item.tag]),
        latitude: item.latitude,
        longitude: item.longitude,
        meters: item.meters,
        url: item.url,
        address: MapsOsm.addressOf(item.tags),
        ...facts,
        website: facts.website ?? MapsTransit.websiteOf(item.tags),
        openingHours: undefined,
        osm: usefulTags(item.tags),
        photoUrl: image?.url,
        photoCredit: image?.credit,
      }
    }),
  )
}

/** The OSM tags that say what a feature is and who runs it. */
function usefulTags(tags: Record<string, string>) {
  const entries = Object.entries(tags).filter((entry) => USEFUL.test(entry[0]))
  return entries.length ? Object.fromEntries(entries) : undefined
}

const USEFUL =
  /^(office|building|amenity|tourism|healthcare|leisure|shop|brand|operator|network|company|official_name|alt_name|level|building:levels|stars|healthcare:speciality|emergency)$/

function transitRow(item: MapsTransit.Feature, walk: MapsAccess.StationWalk | MapsTransit.Walk | undefined, walked: boolean) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    address: item.address,
    website: item.website,
    latitude: item.latitude,
    longitude: item.longitude,
    station: item.nearest.station,
    stationId: item.nearest.stationId,
    lines: item.nearest.lines,
    straightMeters: item.nearest.meters,
    ...(walked
      ? {
          walkingMeters: walk?.meters,
          walkingMinutes: walk ? Math.max(1, Math.round(walk.seconds / 60)) : undefined,
          ...(walk && "from" in walk ? { walkingFrom: walk.from } : {}),
          // A walk from a station access point was judged against its own start; a plain walk against the node.
          walkingNote: walk && "from" in walk ? walk.note : MapsTransit.walkingNote(item.nearest.meters, walk),
        }
      : {}),
    osm: usefulTags(item.tags),
  }
}

/** A compact table for the model: the summary first, so truncation of a long list never hides the totals. */
function transitTable(output: {
  what: string
  radiusMeters: number
  stations: number
  lines: readonly string[]
  total: number
  named: number
  withWebsite: number
  returned: number
  perLine: Record<string, number>
  notice?: string
  features: readonly ReturnType<typeof transitRow>[]
  oneTransit?: string
  rideFeatures?: readonly { id: string; name?: string; category: string; access: string }[]
}) {
  const cell = (value: string | undefined, max: number) => (value ?? "-").replace(/[|\n\r]+/g, " ").slice(0, max) || "-"
  const site = (url: string | undefined) => url?.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")
  const walked = output.features.some((row) => "walkingMeters" in row)
  return [
    `maps_near_transit: ${output.total} ${output.what} features within ${output.radiusMeters} m (straight line) of ${output.stations} stations on ${output.lines.join(", ")}; ${output.named} named, ${output.withWebsite} with a website. Listed: ${output.returned}${output.returned < output.total ? ` (named first, nearest first; raise limit up to 2000 for the rest)` : ""}.`,
    `Per line: ${Object.entries(output.perLine)
      .map(([line, total]) => `${line} ${total}`)
      .join(", ")}.`,
    ...(output.notice ? [`Notice: ${output.notice}`] : []),
    `Straight = from the station node (on the tracks); walk = OSRM foot route${walked ? "" : " (not computed; pass walking: true)"}. Ids work as places in maps_route/maps_matrix.`,
    "# | Name | Category | Nearest station (lines) | Straight m | Walk m / min | Website | Address | Id",
    ...output.features.map((row, index) =>
      [
        index + 1,
        cell(row.name ?? "(unnamed)", 70),
        cell(row.category, 30),
        `${row.station} (${row.lines.join("/")})`,
        row.straightMeters,
        "walkingMeters" in row
          ? row.walkingMeters === undefined
            ? "-"
            : `${row.walkingMeters} / ${row.walkingMinutes}${row.walkingNote ? ` (${row.walkingNote.split(" (")[0]})` : ""}`
          : "-",
        cell(site(row.website), 40),
        cell(row.address, 60),
        row.id,
      ].join(" | "),
    ),
    ...(output.oneTransit
      ? [
          `One transit ride: ${output.oneTransit}. Fares apply.`,
          "# | Name | Category | Akses (1x naik) | Id",
          ...(output.rideFeatures ?? []).map((row, index) =>
            [index + 1, cell(row.name, 70), cell(row.category, 30), cell(row.access, 160), row.id].join(" | "),
          ),
        ]
      : []),
  ].join("\n")
}

function count(values: readonly string[]) {
  return Object.fromEntries(
    [...Map.groupBy(values, (value) => value).entries()]
      .map(([key, items]) => [key, items.length] as const)
      .toSorted((a, b) => b[1] - a[1]),
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

export const __test = {
  SearchInput,
  RouteInput,
  MatrixInput,
  PoiInput,
  TransitInput,
  GeoInput,
  compute,
  transitRow,
  transitTable,
  notices: MapsSearch.notices,
}
