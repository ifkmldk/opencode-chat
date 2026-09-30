import { describe, expect, test } from "bun:test"
import { applyTool, decodePolyline, directionsUrl, emptyScene } from "./scene"

describe("map scene", () => {
  test("decodes the Google polyline example", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)
    expect(points.map((point) => [point.latitude, point.longitude])).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })

  test("searches add places, map_show replaces them and keeps what searches knew", () => {
    const searched = applyTool(emptyScene(), "maps_search", {
      places: [
        { id: "a", name: "Hotel A", latitude: -6.18, longitude: 106.82, rating: 4.6 },
        { id: "b", name: "Hotel B", latitude: -6.17, longitude: 106.83 },
        { id: "x", name: "No coordinates" },
      ],
    })
    expect(searched.places.map((place) => place.id)).toEqual(["a", "b"])
    const shown = applyTool(searched, "map_show", {
      title: "Shortlist",
      places: [{ id: "a", name: "Hotel A", latitude: -6.18, longitude: 106.82, label: "1" }],
      route: { geometry: "_p~iF~ps|U_ulLnnqC", precision: 5, mode: "driving" },
    })
    expect(shown.title).toBe("Shortlist")
    expect(shown.places).toHaveLength(1)
    expect(shown.places[0]?.rating).toBe(4.6)
    expect(shown.route?.points).toHaveLength(2)
  })

  test("hotspots become spots; unrelated output is ignored", () => {
    const scene = applyTool(emptyScene(), "geo_compute", {
      operation: "hotspots",
      spots: [{ latitude: -6.2, longitude: 106.8, value: 9, spot: "hot spot (95%)", z: 2.1 }],
    })
    expect(scene.spots[0]?.spot).toStartWith("hot")
    expect(applyTool(scene, "geo_compute", { operation: "distance" })).toBe(scene)
    expect(applyTool(scene, "maps_search", undefined)).toBe(scene)
  })

  test("builds keyless Google Maps directions through the places", () => {
    const url = new URL(
      directionsUrl([
        { id: "a", name: "A", latitude: 1, longitude: 2 },
        { id: "b", name: "B", latitude: 3, longitude: 4 },
        { id: "c", name: "C", latitude: 5, longitude: 6 },
      ])!,
    )
    expect(url.searchParams.get("origin")).toBe("1,2")
    expect(url.searchParams.get("destination")).toBe("5,6")
    expect(url.searchParams.get("waypoints")).toBe("3,4")
    expect(directionsUrl([{ id: "a", name: "A", latitude: 1, longitude: 2 }])).toBeUndefined()
  })
})
