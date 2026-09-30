import { describe, expect, test } from "bun:test"
import { GeoStats } from "@opencode/core/maps/stats"

describe("GeoStats.classify", () => {
  test("Jenks finds the obvious natural groups", () => {
    const values = [1, 2, 3, 10, 11, 12, 30, 31, 32]
    const result = GeoStats.classify(values, { method: "jenks", classes: 3 })
    expect(result.recommended.breaks.map((entry) => entry.to)).toEqual([3, 12, 32])
    expect(result.recommended.breaks.map((entry) => entry.count)).toEqual([3, 3, 3])
    expect(result.recommended.gvf).toBeGreaterThan(0.99)
  })

  test("recommends a fit with no empty classes and reports the comparison", () => {
    const values = [1, 2, 3, 10, 11, 12, 30, 31, 32]
    const result = GeoStats.classify(values)
    expect(result.recommended.emptyClasses).toBe(0)
    expect(result.recommended.gvf).toBeGreaterThan(0.95)
    expect(result.compared.length).toBeGreaterThan(3)
  })

  test("quantile classes hold equal counts", () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1)
    const result = GeoStats.classify(values, { method: "quantile", classes: 4 })
    expect(result.recommended.breaks.map((entry) => entry.count)).toEqual([5, 5, 5, 5])
  })

  test("heavy-tailed data are summarised with positive skew", () => {
    const values = [...Array.from({ length: 40 }, () => 1), 2, 2, 3, 5, 8, 20, 60, 200]
    const result = GeoStats.classify(values, { method: "head_tail" })
    expect(result.summary.skewness).toBeGreaterThan(2)
    expect(result.recommended.classes).toBeGreaterThanOrEqual(3)
  })

  test("needs at least three values", () => {
    expect(() => GeoStats.classify([1, 2])).toThrow()
  })
})

// A 5x5 grid around Jakarta, ~1.1 km apart.
const grid = Array.from({ length: 25 }, (_, index) => ({
  latitude: -6.2 + Math.floor(index / 5) * 0.01,
  longitude: 106.8 + (index % 5) * 0.01,
  id: `p${index}`,
}))

describe("GeoStats spatial statistics", () => {
  test("Moran's I is positive and significant for a smooth gradient", () => {
    const items = grid.map((point, index) => ({ ...point, value: index % 5 }))
    const result = GeoStats.moransI(items, { k: 4 })
    expect(result.moransI).toBeGreaterThan(0.5)
    expect(result.pseudoP).toBeLessThan(0.05)
    expect(result.pattern).toBe("clustered")
  })

  test("Moran's I is negative for a checkerboard", () => {
    const items = grid.map((point, index) => ({ ...point, value: (Math.floor(index / 5) + (index % 5)) % 2 }))
    const result = GeoStats.moransI(items, { k: 4 })
    expect(result.moransI).toBeLessThan(-0.5)
    expect(result.pattern).toBe("dispersed")
  })

  test("Gi* marks a high-value corner as a hot spot", () => {
    const items = grid.map((point, index) => ({ ...point, value: index % 5 >= 3 && index >= 15 ? 100 : 1 }))
    const spots = GeoStats.hotspots(items, { k: 4 })
    expect(spots.find((spot) => spot.id === "p24")?.spot).toStartWith("hot")
    expect(spots.find((spot) => spot.id === "p0")?.spot).not.toStartWith("hot")
  })

  test("a regular grid is dispersed, a tight clump is clustered", () => {
    const area = 0.05 * 0.05 * 111_000 * 110_000
    expect(GeoStats.nearestNeighborIndex(grid, area).ratio).toBeGreaterThan(1.5)
    const clump = [
      ...Array.from({ length: 12 }, (_, index) => ({ latitude: -6.2 + index * 0.0001, longitude: 106.8 })),
      { latitude: -6.16, longitude: 106.84 },
    ]
    expect(GeoStats.nearestNeighborIndex(clump, area).pattern).toBe("clustered")
  })

  test("centrography finds the weighted centre", () => {
    const result = GeoStats.centrography([
      { latitude: -6.2, longitude: 106.8, weight: 1 },
      { latitude: -6.2, longitude: 106.82, weight: 3 },
    ])
    expect(result.meanCenter.longitude).toBeCloseTo(106.815, 3)
    expect(result.crs).toContain("EPSG:32748")
  })
})
