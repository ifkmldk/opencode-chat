import { Geo } from "../maps/geo.js"
import { Stations } from "../maps/stations.js"

// fork: station coordinates come from the OSM station dataset (maps/stations.ts); the old hand-typed Rangkasbitung
// list was off by up to 6.7 km and lacked Jatake.

export type Station = Stations.Station

export const RANGKASBITUNG_STATIONS = Stations.list({ lines: ["rangkasbitung"] })

/**
 * The nearest station on the given lines (default: every KRL line). orchestrate.ts still passes a station list, which
 * is accepted as is.
 */
export function nearestStation(
  point: Geo.Point,
  scope: Stations.Filter | readonly Station[] = {},
): { station: Station; meters: number } {
  const stations = "length" in scope ? scope : Stations.list(scope)
  // An empty or unknown line filter falls back to every KRL station rather than returning nothing.
  const found = Geo.nearest(point, stations.length ? stations : Stations.list(), 1)[0]!
  return { station: found.item, meters: found.meters }
}
