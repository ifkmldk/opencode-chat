export * as GeoStats from "./stats.js"

import { Geo } from "./geo.js"

// fork: thematic classification and spatial statistics for geo_compute. Everything is deterministic and local.

export type ClassMethod = "jenks" | "quantile" | "equal_interval" | "std_dev" | "head_tail"
export const CLASS_METHODS: readonly ClassMethod[] = ["jenks", "quantile", "equal_interval", "std_dev", "head_tail"]

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const mean = (values: readonly number[]) => sum(values) / values.length
const sorted = (values: readonly number[]) => values.toSorted((a, b) => a - b)

function sdcm(values: readonly number[]) {
  const average = mean(values)
  return sum(values.map((value) => (value - average) ** 2))
}

export function describe(values: readonly number[]) {
  const data = sorted(values)
  const n = data.length
  const average = mean(data)
  const variance = sdcm(data) / n
  const deviation = Math.sqrt(variance)
  const quantile = (q: number) => {
    const position = (n - 1) * q
    const low = Math.floor(position)
    const high = Math.ceil(position)
    return data[low]! + (data[high]! - data[low]!) * (position - low)
  }
  const skewness = deviation === 0 ? 0 : sum(data.map((value) => ((value - average) / deviation) ** 3)) / n
  return {
    count: n,
    min: data[0]!,
    max: data[n - 1]!,
    mean: average,
    median: quantile(0.5),
    q1: quantile(0.25),
    q3: quantile(0.75),
    stdDev: deviation,
    skewness,
  }
}

/** Fisher–Jenks optimal breaks: minimises within-class squared deviation exactly (dynamic programming). */
function jenks(data: readonly number[], k: number) {
  const n = data.length
  const lower = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0))
  const variance = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity))
  for (let j = 1; j <= k; j++) {
    lower[1]![j] = 1
    variance[1]![j] = 0
  }
  for (let l = 2; l <= n; l++) {
    let s1 = 0
    let s2 = 0
    let w = 0
    let v = 0
    for (let m = 1; m <= l; m++) {
      const i = l - m + 1
      const value = data[i - 1]!
      s2 += value * value
      s1 += value
      w++
      v = s2 - (s1 * s1) / w
      if (i === 1) continue
      for (let j = 2; j <= k; j++) {
        const candidate = v + variance[i - 1]![j - 1]!
        if (variance[l]![j]! >= candidate) {
          lower[l]![j] = i
          variance[l]![j] = candidate
        }
      }
    }
    lower[l]![1] = 1
    variance[l]![1] = v
  }
  const breaks = new Array<number>(k + 1)
  breaks[k] = data[n - 1]!
  breaks[0] = data[0]!
  let index = n
  for (let j = k; j >= 2; j--) {
    const id = lower[index]![j]! - 1
    breaks[j - 1] = data[id - 1] ?? data[0]!
    index = id
  }
  return breaks
}

/** Upper bounds per class (the last is the maximum). */
function upperBounds(method: ClassMethod, data: readonly number[], k: number): number[] {
  const min = data[0]!
  const max = data[data.length - 1]!
  switch (method) {
    case "equal_interval":
      return Array.from({ length: k }, (_, index) => (index === k - 1 ? max : min + ((max - min) * (index + 1)) / k))
    case "quantile":
      return Array.from({ length: k }, (_, index) => {
        if (index === k - 1) return max
        return data[Math.min(data.length - 1, Math.ceil(((index + 1) * data.length) / k) - 1)]!
      })
    case "jenks":
      return jenks(data, k).slice(1)
    case "std_dev": {
      // Classes one standard deviation wide, centred on the mean; k is ignored beyond the data range.
      const average = mean(data)
      const deviation = Math.sqrt(sdcm(data) / data.length) || 1
      const bounds: number[] = []
      for (let step = -3; step <= 3; step++) {
        const bound = average + (step - 0.5) * deviation
        if (bound > min && bound < max) bounds.push(bound)
      }
      return [...bounds, max]
    }
    case "head_tail": {
      // Jiang's head/tail breaks for heavy-tailed data: split at the mean while the head stays under 40%.
      const bounds: number[] = []
      let rest = data
      while (rest.length > 1 && bounds.length < k - 1) {
        const average = mean(rest)
        const head = rest.filter((value) => value > average)
        if (!head.length || head.length / rest.length > 0.4) break
        bounds.push(average)
        rest = head
      }
      return [...bounds, max]
    }
  }
}

function assign(value: number, bounds: readonly number[]) {
  const index = bounds.findIndex((bound) => value <= bound)
  return index === -1 ? bounds.length - 1 : index
}

function evaluate(method: ClassMethod, data: readonly number[], k: number) {
  const bounds = upperBounds(method, data, k)
  const groups = bounds.map(() => [] as number[])
  for (const value of data) groups[assign(value, bounds)]!.push(value)
  const total = sdcm(data)
  const within = sum(groups.filter((group) => group.length).map(sdcm))
  // Goodness of variance fit: 1 = classes explain all variance.
  const gvf = total === 0 ? 1 : 1 - within / total
  const average = mean(data)
  const tai =
    sum(data.map((value) => Math.abs(value - average))) === 0
      ? 1
      : 1 -
        sum(
          groups
            .filter((group) => group.length)
            .map((group) => sum(group.map((value) => Math.abs(value - mean(group))))),
        ) /
          sum(data.map((value) => Math.abs(value - average)))
  const lowers = [data[0]!, ...bounds.slice(0, -1)]
  return {
    method,
    classes: bounds.length,
    gvf,
    tai,
    emptyClasses: groups.filter((group) => !group.length).length,
    breaks: bounds.map((upper, index) => ({ from: lowers[index]!, to: upper, count: groups[index]!.length })),
  }
}

/**
 * Classify values for a thematic (choropleth / graduated) map. With no method it compares every method for 3–7
 * classes and recommends the one with the best goodness of variance fit that leaves no class empty, preferring
 * fewer classes when the fit gains less than 0.02.
 */
export function classify(values: readonly number[], options: { method?: ClassMethod; classes?: number } = {}) {
  const data = sorted(values.filter(Number.isFinite))
  if (data.length < 3) throw new Error("classify needs at least 3 numeric values")
  const summary = describe(data)
  const unique = new Set(data).size
  const counts = options.classes
    ? [Math.max(2, Math.min(9, Math.round(options.classes), unique))]
    : [3, 4, 5, 6, 7].filter((k) => k <= unique)
  const methods = options.method ? [options.method] : CLASS_METHODS
  const results = methods.flatMap((method) => counts.map((k) => evaluate(method, data, k)))
  const usable = results.filter((result) => result.emptyClasses === 0 && result.classes >= 2)
  const pool = usable.length ? usable : results
  const best = pool.reduce((winner, result) => {
    if (result.gvf > winner.gvf + 0.02) return result
    if (Math.abs(result.gvf - winner.gvf) <= 0.02 && result.classes < winner.classes) return result
    return winner
  })
  const reason =
    best.method === "head_tail"
      ? "the data are heavy-tailed (few large values), which head/tail breaks keep visible"
      : best.method === "quantile"
        ? "equal-count classes fit these data best"
        : best.method === "std_dev"
          ? "the data are close to symmetric, so deviation from the mean reads best"
          : best.method === "equal_interval"
            ? "the values are spread evenly, so equal ranges fit"
            : "natural breaks minimise the variance inside each class"
  return {
    summary,
    recommended: { ...best, reason },
    compared: results
      .toSorted((a, b) => b.gvf - a.gvf)
      .slice(0, 12)
      .map(({ method, classes, gvf, tai, emptyClasses }) => ({ method, classes, gvf, tai, emptyClasses })),
    note: "GVF = goodness of variance fit (1 = perfect), TAI = tabular accuracy index. Classes with no values are avoided.",
  }
}

export type Valued = Geo.Point & { readonly value: number; readonly id?: string; readonly name?: string }

/** Row-standardised weights: the k nearest neighbours (geodesic), or everything within `distance` meters. */
function weights(items: readonly Valued[], options: { k?: number; distance?: number }) {
  return items.map((item, i) => {
    const others = items.flatMap((other, j) => (i === j ? [] : [{ j, meters: Geo.inverse(item, other).meters }]))
    const chosen = options.distance
      ? others.filter((entry) => entry.meters <= options.distance!)
      : others.toSorted((a, b) => a.meters - b.meters).slice(0, Math.max(1, options.k ?? Math.min(8, items.length - 1)))
    return chosen.map((entry) => ({ j: entry.j, w: 1 / chosen.length }))
  })
}

function normalCdf(z: number) {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Global Moran's I with a permutation test (999 deterministic shuffles). */
export function moransI(items: readonly Valued[], options: { k?: number; distance?: number } = {}) {
  if (items.length < 4) throw new Error("morans_i needs at least 4 points")
  const w = weights(items, options)
  const values = items.map((item) => item.value)
  const statistic = (x: readonly number[]) => {
    const average = mean(x)
    const z = x.map((value) => value - average)
    const denominator = sum(z.map((value) => value * value))
    if (denominator === 0) return 0
    const numerator = sum(w.map((row, i) => sum(row.map((entry) => entry.w * z[i]! * z[entry.j]!))))
    const total = sum(w.map((row) => sum(row.map((entry) => entry.w))))
    return (items.length / total) * (numerator / denominator)
  }
  const observed = statistic(values)
  const expected = -1 / (items.length - 1)
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const permutations = 999
  let extreme = 0
  for (let p = 0; p < permutations; p++) {
    const shuffled = [...values]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    if (Math.abs(statistic(shuffled) - expected) >= Math.abs(observed - expected)) extreme++
  }
  const pseudoP = (extreme + 1) / (permutations + 1)
  return {
    moransI: observed,
    expected,
    pseudoP,
    permutations,
    pattern: pseudoP > 0.05 ? "random (not significant)" : observed > expected ? "clustered" : "dispersed",
    weights: options.distance
      ? `distance band ${options.distance} m, row-standardised`
      : `k=${options.k ?? Math.min(8, items.length - 1)} nearest neighbours, row-standardised`,
  }
}

/** Getis–Ord Gi* hot and cold spots (z-scores, two-sided p). */
export function hotspots(items: readonly Valued[], options: { k?: number; distance?: number } = {}) {
  if (items.length < 4) throw new Error("hotspots needs at least 4 points")
  const n = items.length
  const values = items.map((item) => item.value)
  const average = mean(values)
  const s = Math.sqrt(sum(values.map((value) => value * value)) / n - average * average)
  // Gi* includes the point itself, with binary weights.
  const neighbours = weights(items, options).map((row, i) => [i, ...row.map((entry) => entry.j)])
  return items.map((item, i) => {
    const set = neighbours[i]!
    const wSum = set.length
    const lagged = sum(set.map((j) => values[j]!))
    const denominator = s * Math.sqrt((n * wSum - wSum * wSum) / (n - 1))
    const z = denominator === 0 ? 0 : (lagged - average * wSum) / denominator
    const p = 2 * (1 - normalCdf(Math.abs(z)))
    const confidence = p <= 0.01 ? 99 : p <= 0.05 ? 95 : p <= 0.1 ? 90 : 0
    return {
      id: item.id,
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      value: item.value,
      z,
      p,
      spot: confidence ? `${z > 0 ? "hot" : "cold"} spot (${confidence}%)` : "not significant",
    }
  })
}

/** Clark–Evans nearest-neighbour index over the points' convex hull (R < 1 clustered, R > 1 dispersed). */
export function nearestNeighborIndex(points: readonly Geo.Point[], areaSquareMeters?: number) {
  if (points.length < 3) throw new Error("nearest_neighbor_index needs at least 3 points")
  const area = areaSquareMeters ?? Geo.convexHull(points).squareMeters
  if (!(area > 0)) throw new Error("nearest_neighbor_index needs a study area larger than 0")
  const distances = points.map((point, i) =>
    Math.min(...points.flatMap((other, j) => (i === j ? [] : [Geo.inverse(point, other).meters]))),
  )
  const observed = mean(distances)
  const density = points.length / area
  const expected = 0.5 / Math.sqrt(density)
  const r = observed / expected
  const se = 0.26136 / Math.sqrt(points.length * density)
  const z = (observed - expected) / se
  const p = 2 * (1 - normalCdf(Math.abs(z)))
  return {
    observedMeanMeters: observed,
    expectedMeanMeters: expected,
    ratio: r,
    z,
    p,
    areaSquareMeters: area,
    pattern: p > 0.05 ? "random (not significant)" : r < 1 ? "clustered" : "dispersed",
    note: "Study area defaults to the convex hull, which biases R upward for small samples; pass area_m2 for a known area.",
  }
}

/** Weighted mean centre and standard distance (dispersion radius). */
export function centrography(items: readonly (Geo.Point & { readonly weight?: number })[]) {
  if (!items.length) throw new Error("centrography needs points")
  const projected = Geo.project(items)
  const w = items.map((item) => (item.weight !== undefined && item.weight > 0 ? item.weight : 1))
  const total = sum(w)
  const x = sum(projected.coordinates.map((c, i) => c.easting * w[i]!)) / total
  const y = sum(projected.coordinates.map((c, i) => c.northing * w[i]!)) / total
  const standardDistance = Math.sqrt(
    sum(projected.coordinates.map((c, i) => w[i]! * ((c.easting - x) ** 2 + (c.northing - y) ** 2))) / total,
  )
  const [center] = Geo.unproject([{ easting: x, northing: y }], projected.zone)
  return {
    meanCenter: center!,
    standardDistanceMeters: standardDistance,
    crs: `UTM ${projected.zone.zone}${projected.zone.hemisphere} (EPSG:${projected.zone.epsg})`,
  }
}
