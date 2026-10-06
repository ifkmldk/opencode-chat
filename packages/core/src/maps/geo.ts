export * as Geo from "./geo.js"

import { Geodesic } from "geographiclib-geodesic"
import proj4 from "proj4"

// fork: deterministic geodesy for the maps tools. Distances, buffers and areas are computed on the WGS84
// ellipsoid with Karney's algorithms (GeographicLib), which are accurate to nanometres; planar work (convex
// hulls) happens in the point set's own UTM zone.

export type Point = { readonly latitude: number; readonly longitude: number }

export const method = "WGS84 ellipsoid, geodesics by Karney (GeographicLib)"

const geod = Geodesic.WGS84

export function inverse(a: Point, b: Point) {
  const result = geod.Inverse(a.latitude, a.longitude, b.latitude, b.longitude, Geodesic.DISTANCE | Geodesic.AZIMUTH)
  return {
    meters: result.s12 ?? 0,
    azimuth: azimuth(result.azi1 ?? 0),
    finalAzimuth: azimuth(result.azi2 ?? 0),
  }
}

export function destination(from: Point, bearing: number, meters: number): Point {
  const result = geod.Direct(from.latitude, from.longitude, bearing, meters, Geodesic.LATITUDE | Geodesic.LONGITUDE)
  return { latitude: result.lat2 ?? from.latitude, longitude: result.lon2 ?? from.longitude }
}

export function nearest<T extends Point>(origin: Point, items: readonly T[], k = items.length) {
  return items
    .map((item) => ({ item, meters: inverse(origin, item).meters }))
    .toSorted((a, b) => a.meters - b.meters)
    .slice(0, k)
}

export function within<T extends Point>(center: Point, meters: number, items: readonly T[]) {
  return nearest(center, items).filter((entry) => entry.meters <= meters)
}

/**
 * The centre nearest to a point. A planar estimate shortlists three centres and only those get the exact geodesic,
 * so thousands of points against a hundred centres stay fast while the distance reported is still exact.
 */
export function nearestCentre<C extends Point>(point: Point, centres: readonly C[]) {
  const scale = Math.cos(radians(point.latitude))
  return centres
    .map((centre) => ({
      centre,
      estimate: (centre.latitude - point.latitude) ** 2 + (wrap(centre.longitude - point.longitude) * scale) ** 2,
    }))
    .toSorted((a, b) => a.estimate - b.estimate)
    .slice(0, 3)
    .map((entry) => ({ centre: entry.centre, meters: inverse(point, entry.centre).meters }))
    .toSorted((a, b) => a.meters - b.meters)[0]
}

/** Every point with its nearest centre; with a radius, `within` says whether that centre is close enough. */
export function nearAny<T extends Point, C extends Point>(
  points: readonly T[],
  centres: readonly C[],
  meters?: number,
) {
  return points.flatMap((item) => {
    const found = nearestCentre(item, centres)
    if (!found) return []
    return [
      { item, centre: found.centre, meters: found.meters, within: meters === undefined || found.meters <= meters },
    ]
  })
}

/** A geodesic circle: every vertex lies exactly `meters` from the centre on the ellipsoid. */
export function circle(center: Point, meters: number, vertices = 64) {
  return Array.from({ length: vertices }, (_, index) => destination(center, (360 / vertices) * index, meters))
}

/** Area and perimeter of a simple polygon on the WGS84 ellipsoid. The ring may be open or closed. */
export function polygon(ring: readonly Point[]) {
  const area = geod.Polygon(false)
  openRing(ring).forEach((point) => area.AddPoint(point.latitude, point.longitude))
  const result = area.Compute(false, true)
  return { squareMeters: Math.abs(result.area ?? 0), perimeterMeters: result.perimeter }
}

export function length(path: readonly Point[]) {
  return path.slice(1).reduce((total, point, index) => total + inverse(path[index]!, point).meters, 0)
}

export function bbox(points: readonly Point[]) {
  return {
    south: Math.min(...points.map((point) => point.latitude)),
    west: Math.min(...points.map((point) => point.longitude)),
    north: Math.max(...points.map((point) => point.latitude)),
    east: Math.max(...points.map((point) => point.longitude)),
  }
}

/** Mean of unit vectors, so points spread across a wide area still average correctly. */
export function centroid(points: readonly Point[]): Point {
  const sum = points.reduce(
    (total, point) => {
      const lat = radians(point.latitude)
      const lon = radians(point.longitude)
      return {
        x: total.x + Math.cos(lat) * Math.cos(lon),
        y: total.y + Math.cos(lat) * Math.sin(lon),
        z: total.z + Math.sin(lat),
      }
    },
    { x: 0, y: 0, z: 0 },
  )
  return {
    latitude: degrees(Math.atan2(sum.z, Math.hypot(sum.x, sum.y))),
    longitude: degrees(Math.atan2(sum.y, sum.x)),
  }
}

export function utmZone(point: Point) {
  const zone = Math.min(60, Math.floor((point.longitude + 180) / 6) + 1)
  const south = point.latitude < 0
  return {
    zone,
    hemisphere: south ? ("S" as const) : ("N" as const),
    epsg: (south ? 32700 : 32600) + zone,
    definition: `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`,
  }
}

/** Projects to the UTM zone of the points' centroid (or the given zone). */
export function project(points: readonly Point[], zone = utmZone(centroid(points))) {
  const converter = proj4("EPSG:4326", zone.definition)
  return {
    zone,
    coordinates: points.map((point) => {
      const [easting, northing] = converter.forward([point.longitude, point.latitude])
      return { easting: easting!, northing: northing! }
    }),
  }
}

export function unproject(
  coordinates: readonly { easting: number; northing: number }[],
  zone: ReturnType<typeof utmZone>,
) {
  const converter = proj4("EPSG:4326", zone.definition)
  return coordinates.map((coordinate) => {
    const [longitude, latitude] = converter.inverse([coordinate.easting, coordinate.northing])
    return { latitude: latitude!, longitude: longitude! }
  })
}

/** Convex hull (monotone chain) computed in UTM, returned as a lat/lng ring with its ellipsoidal area. */
export function convexHull(points: readonly Point[]) {
  if (points.length < 3) return { ring: [...points], ...polygon(points), zone: utmZone(centroid(points)) }
  const projected = project(points)
  const indexed = projected.coordinates
    .map((coordinate, index) => ({ ...coordinate, index }))
    .toSorted((a, b) => a.easting - b.easting || a.northing - b.northing)
  const cross = (o: (typeof indexed)[number], a: (typeof indexed)[number], b: (typeof indexed)[number]) =>
    (a.easting - o.easting) * (b.northing - o.northing) - (a.northing - o.northing) * (b.easting - o.easting)
  const half = (list: typeof indexed) =>
    list.reduce<typeof indexed>((hull, point) => {
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop()
      hull.push(point)
      return hull
    }, [])
  const lower = half(indexed)
  const upper = half(indexed.toReversed())
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)].map((point) => points[point.index]!)
  return { ring, ...polygon(ring), zone: projected.zone }
}

/** DBSCAN on geodesic distances. A cluster of -1 marks noise. */
export function dbscan<T extends Point>(items: readonly T[], epsMeters: number, minPoints: number) {
  const labels = new Array<number | undefined>(items.length).fill(undefined)
  const neighbours = (index: number) =>
    items.flatMap((item, other) => (inverse(items[index]!, item).meters <= epsMeters ? [other] : []))
  const next = { cluster: 0 }
  items.forEach((_, index) => {
    if (labels[index] !== undefined) return
    const seeds = neighbours(index)
    if (seeds.length < minPoints) {
      labels[index] = -1
      return
    }
    const cluster = next.cluster++
    labels[index] = cluster
    const queue = seeds.filter((seed) => seed !== index)
    while (queue.length) {
      const current = queue.shift()!
      if (labels[current] === -1) labels[current] = cluster
      if (labels[current] !== undefined) continue
      labels[current] = cluster
      const more = neighbours(current)
      if (more.length >= minPoints) queue.push(...more.filter((candidate) => labels[candidate] === undefined))
    }
  })
  return items.map((item, index) => ({ item, cluster: labels[index] ?? -1 }))
}

/** Decodes an encoded polyline (Google/OSRM format). OSRM `polyline6` uses precision 6. */
export function decodePolyline(encoded: string, precision = 5): Point[] {
  const factor = 10 ** precision
  const state = { index: 0, latitude: 0, longitude: 0 }
  const points: Point[] = []
  const read = () => {
    const value = { result: 0, shift: 0, byte: 0x20 }
    while (value.byte >= 0x20 && state.index < encoded.length) {
      value.byte = encoded.charCodeAt(state.index++) - 63
      value.result |= (value.byte & 0x1f) << value.shift
      value.shift += 5
    }
    return value.result & 1 ? ~(value.result >> 1) : value.result >> 1
  }
  while (state.index < encoded.length) {
    state.latitude += read()
    state.longitude += read()
    points.push({ latitude: state.latitude / factor, longitude: state.longitude / factor })
  }
  return points
}

export type Criterion = { readonly key: string; readonly weight: number; readonly better: "lower" | "higher" }
export type Candidate = {
  readonly id: string
  readonly name?: string
  readonly values: Record<string, number | undefined>
}

/**
 * Weighted multi-criteria ranking with min-max normalisation per criterion (1 = best). A missing value scores 0 on
 * that criterion and is reported, so a candidate never wins on data it doesn't have.
 */
export function rank(candidates: readonly Candidate[], criteria: readonly Criterion[]) {
  const total = criteria.reduce((sum, criterion) => sum + Math.max(0, criterion.weight), 0) || 1
  const ranges = new Map(
    criteria.map((criterion) => {
      const values = candidates.flatMap((candidate) => {
        const value = candidate.values[criterion.key]
        return value === undefined || !Number.isFinite(value) ? [] : [value]
      })
      return [criterion.key, { min: Math.min(...values), max: Math.max(...values) }] as const
    }),
  )
  return candidates
    .map((candidate) => {
      const parts = criteria.map((criterion) => {
        const value = candidate.values[criterion.key]
        const range = ranges.get(criterion.key)!
        if (value === undefined || !Number.isFinite(value))
          return { key: criterion.key, value, normalized: 0, missing: true }
        const span = range.max - range.min
        const normalized =
          span === 0 ? 1 : criterion.better === "lower" ? (range.max - value) / span : (value - range.min) / span
        return { key: criterion.key, value, normalized, missing: false }
      })
      const score =
        criteria.reduce((sum, criterion, index) => sum + Math.max(0, criterion.weight) * parts[index]!.normalized, 0) /
        total
      return { id: candidate.id, name: candidate.name, score, parts }
    })
    .toSorted((a, b) => b.score - a.score)
}

function openRing(ring: readonly Point[]) {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && ring.length > 1 && first.latitude === last.latitude && first.longitude === last.longitude)
    return ring.slice(0, -1)
  return ring
}

function wrap(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

function azimuth(value: number) {
  return (value + 360) % 360
}

function radians(value: number) {
  return (value * Math.PI) / 180
}

function degrees(value: number) {
  return (value * 180) / Math.PI
}
