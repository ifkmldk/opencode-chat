import { describe, expect, test } from "bun:test"
import { Geo } from "../../src/maps/geo.js"

const monas = { latitude: -6.1754, longitude: 106.8272 }

describe("geodesy on the WGS84 ellipsoid", () => {
  test("one degree along the equator is exactly a·π/180", () => {
    expect(Geo.inverse({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }).meters).toBeCloseTo(
      (6378137 * Math.PI) / 180,
      6,
    )
  })

  test("one degree of meridian from the equator matches the WGS84 meridian arc", () => {
    // Meridian arc length 0°→1° on WGS84: 110574.3885577987 m.
    expect(Geo.inverse({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }).meters).toBeCloseTo(
      110574.3885578,
      4,
    )
  })

  test("direct and inverse problems agree, and bearings are 0–360°", () => {
    const target = Geo.destination(monas, 135, 12_345.678)
    const back = Geo.inverse(monas, target)
    expect(back.meters).toBeCloseTo(12_345.678, 6)
    expect(back.azimuth).toBeCloseTo(135, 8)
    expect(Geo.inverse(target, monas).azimuth).toBeGreaterThanOrEqual(0)
  })

  test("a geodesic circle keeps every vertex at the radius", () => {
    const ring = Geo.circle(monas, 500, 36)
    expect(ring).toHaveLength(36)
    ring.forEach((point) => expect(Geo.inverse(monas, point).meters).toBeCloseTo(500, 6))
  })

  test("the area of a 1°×1° cell on the equator", () => {
    const cell = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 0 },
    ]
    // Reference value from GeographicLib (Planimeter) for this cell.
    expect(Geo.polygon(cell).squareMeters / 1e6).toBeCloseTo(12308.778361, 3)
    expect(Geo.polygon([...cell, cell[0]!]).squareMeters).toBeCloseTo(Geo.polygon(cell).squareMeters, 6)
  })

  test("Jakarta falls in UTM 48S and projects round-trip", () => {
    const zone = Geo.utmZone(monas)
    expect(zone).toMatchObject({ zone: 48, hemisphere: "S", epsg: 32748 })
    const projected = Geo.project([monas])
    expect(projected.coordinates[0]!.easting).toBeGreaterThan(690_000)
    expect(projected.coordinates[0]!.northing).toBeGreaterThan(9_300_000)
    const [back] = Geo.unproject(projected.coordinates, projected.zone)
    expect(back!.latitude).toBeCloseTo(monas.latitude, 8)
    expect(back!.longitude).toBeCloseTo(monas.longitude, 8)
  })

  test("nearest, within and centroid", () => {
    const points = [
      { id: "far", latitude: -6.3, longitude: 106.7 },
      { id: "near", latitude: -6.176, longitude: 106.828 },
      { id: "mid", latitude: -6.2, longitude: 106.85 },
    ]
    expect(Geo.nearest(monas, points, 2).map((entry) => entry.item.id)).toEqual(["near", "mid"])
    expect(Geo.within(monas, 1000, points).map((entry) => entry.item.id)).toEqual(["near"])
    const center = Geo.centroid([
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 20 },
    ])
    expect(center.latitude).toBeCloseTo(0, 9)
    expect(center.longitude).toBeCloseTo(15, 9)
  })

  test("convex hull drops interior points", () => {
    const square = [
      { latitude: -6.2, longitude: 106.8 },
      { latitude: -6.2, longitude: 106.81 },
      { latitude: -6.19, longitude: 106.81 },
      { latitude: -6.19, longitude: 106.8 },
    ]
    const hull = Geo.convexHull([...square, { latitude: -6.195, longitude: 106.805 }])
    expect(hull.ring).toHaveLength(4)
    expect(hull.squareMeters).toBeCloseTo(Geo.polygon(square).squareMeters, 3)
  })

  test("DBSCAN separates two groups and marks outliers", () => {
    const clusters = Geo.dbscan(
      [
        { latitude: -6.2, longitude: 106.8 },
        { latitude: -6.2001, longitude: 106.8001 },
        { latitude: -6.3, longitude: 106.9 },
        { latitude: -6.3001, longitude: 106.9001 },
        { latitude: -7, longitude: 110 },
      ],
      100,
      2,
    )
    expect(clusters.map((entry) => entry.cluster)).toEqual([0, 0, 1, 1, -1])
  })

  test("decodes encoded polylines (Google's reference example)", () => {
    expect(Geo.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ])
  })

  test("ranking normalises each criterion and penalises missing values", () => {
    const ranking = Geo.rank(
      [
        { id: "a", values: { minutes: 10, rating: 4.1 } },
        { id: "b", values: { minutes: 25, rating: 4.8 } },
        { id: "c", values: { minutes: 12 } },
      ],
      [
        { key: "minutes", weight: 2, better: "lower" },
        { key: "rating", weight: 1, better: "higher" },
      ],
    )
    expect(ranking.map((row) => row.id)).toEqual(["a", "c", "b"])
    expect(ranking.find((row) => row.id === "c")!.parts.find((part) => part.key === "rating")!.missing).toBe(true)
  })
})
