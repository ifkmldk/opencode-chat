export * as ResearchOrchestrate from "./orchestrate.js"

import { Effect, Result } from "effect"
import { ToolFailure } from "@opencode/ai"
import type { MapsCategory } from "../maps/categories.js"
import { MapsCompany } from "../maps/company.js"
import type { MapsError } from "../maps/error.js"
import { Geo } from "../maps/geo.js"
import type { MapsSearch } from "../maps/search.js"
import { Stations } from "../maps/stations.js"
import { MapsOsm } from "../maps/osm.js"
import { MapsTransit } from "../maps/transit-buffer.js"
import type { MapsAccess } from "../maps/station-access.js"
import { MapsRide } from "../maps/transit-ride.js"
import { NetGuard } from "../net-guard.js"
import type { Boards } from "../scrape/boards.js"
import { ScrapeExtract } from "../scrape/extract.js"
import { JobBoards } from "../scrape/jobboards.js"
import { Salary } from "../scrape/salary.js"
import { extractConstraints, linesOf, mustNegated, mustPattern, type AccessMode, type Constraints, type TravelMode } from "./constraints.js"
import { JobRelevance } from "./relevance.js"

// fork: one research run per question. Jobs: every board for every role phrase and city, web and social posts on top,
// a salary floor that only drops disclosed salaries below it, and the OFFICE of every employer located on the map, its
// nearest station and walking distance measured, nothing hidden (rows without a location or outside the radius get
// their own tables). Places: the category is searched by OSM tag around the anchor or around the stations.

export type Category = "job" | "hotel" | "flight" | "product" | "youtube" | "place" | "event" | "course" | "service" | "other"

export type DeepInput = {
  query: string
  category: Category
  location?: string
  anchor?: string
  radiusKm?: number
  must?: readonly string[]
  /** "KRL", "KRL Rangkasbitung", "semua jalur", "Stasiun Serpong". */
  transitLine?: string
  /** Line ids ("rangkasbitung") or names. */
  lines?: readonly string[]
  maxResults?: number
  /** Monthly salary floor in rupiah. */
  minSalary?: number
  budget?: number
  travelMode?: TravelMode
  /** "walk" (default): on foot from the station; "walk_or_one_transit" also counts one direct bus/angkot ride from it. */
  accessMode?: AccessMode
}

export type Candidate = {
  id: string
  category: Category
  title: string
  provider?: string
  company?: string
  location?: string
  address?: string
  latitude?: number
  longitude?: number
  url?: string
  summary?: string
  distanceM?: number
  walkingM?: number
  anchor?: string
  travelMode?: TravelMode
  travelMinutes?: number
  station?: string
  salary?: string
  posted?: string
  verified?: Record<string, "yes" | "no" | "unknown">
  checkedAt?: number
  source?: "openstreetmap" | "web-search" | "scraped"
  priceNote?: string
}

export type Provider = { provider: string; status: "configured" | "unavailable" | "error"; message?: string }

export type DeepResult = {
  query: string
  category: Category
  providers: Provider[]
  candidates: Candidate[]
  /** Main table: job listings that meet every constraint, or the places found. */
  table?: string
  /** Job listings whose office could not be located, with the reason. */
  unlocatedTable?: string
  /** Job listings whose office is outside the requested radius. */
  outsideTable?: string
  /** Every named employer within the radius of the stations, with its career page check. */
  companyTable?: string
  /** Career pages of the employers in the main table (searches without stations). */
  careerTable?: string
  summary?: string
  anchor?: { name: string; latitude: number; longitude: number }
  limitations: string[]
  checkedAt: number
}

type WebHit = { url: string; title?: string; content?: string }
type Transit = {
  stations: readonly Stations.Station[]
  features: readonly MapsTransit.Feature[]
  total: number
  notice?: string
}

export type Deps = {
  searchPlaces: (input: { query: string; near?: string; limit: number; radiusKm?: number }) => Effect.Effect<
    {
      provider: string
      places: MapsSearch.Place[]
      center?: { name?: string; latitude: number; longitude: number }
      notice?: string
      total?: number
      radiusMeters?: number
    },
    ToolFailure
  >
  /** Web search; `exact` sends the text once as written (site: queries), otherwise a few job phrasings are tried. */
  searchJobs?: (input: { query: string; limit: number; exact?: boolean }) => Effect.Effect<
    { results: WebHit[]; error?: string },
    ToolFailure
  >
  scrape: (url: string) => Effect.Effect<{ text: string; source: string }>
  /** Listings the user already applied to or rejected (saved as memory notes): they never come back in results. */
  excluded?: () => Effect.Effect<readonly string[]>
  /**
   * Listings read from the job boards, one search per board × role phrase × city. kind "quick" reads only the boards
   * with a JSON API (seconds), "browser" only those read with the headless browser (minutes); omitted reads all.
   */
  board?: (input: {
    phrases: readonly string[]
    cities: readonly string[]
    kind?: "quick" | "browser"
    /** Called with each finished search's listings, before the whole read is done. */
    onListings?: (listings: readonly JobBoards.Listing[]) => void
  }) => Effect.Effect<{
    listings: readonly JobBoards.Listing[]
    reports: readonly Boards.Report[]
    manual: readonly { board: string; url: string; note: string }[]
    skipped?: readonly Boards.Search[]
  }>
  /** Opens the employer's own career page (its OSM website when known) and says whether a role phrase shows there. */
  careers?: (input: { company: string; phrases: readonly string[]; website?: string }) => Effect.Effect<JobBoards.Career>
  /**
   * Coordinates for an address text. Photon first: Nominatim allows one request per second, and the office lookup
   * already queues on it.
   */
  geocode?: (text: string) => Effect.Effect<{ name: string; latitude: number; longitude: number } | undefined>
  /** Where a company's office is (OSM office, building or brand; else the listing address). */
  locateCompany?: (input: MapsCompany.Request) => Effect.Effect<MapsCompany.Lookup>
  /** Every feature of a kind within a radius of the given stations or lines. */
  nearTransit?: (input: MapsTransit.Input) => Effect.Effect<Transit, MapsError | ToolFailure>
  /** Walking meters and seconds per pair (OSRM foot); undefined where no route was found. */
  walking?: (pairs: readonly { from: Geo.Point; to: Geo.Point }[]) => Effect.Effect<readonly (MapsTransit.Walk | undefined)[]>
  /** Walks from stations that start at the station's entrances or outline (MapsAccess.fromStations); else `walking` from the node. */
  stationWalking?: (
    pairs: readonly { station: Stations.Station; to: Geo.Point }[],
  ) => Effect.Effect<readonly (MapsAccess.StationWalk | undefined)[]>
  /** Bus, TransJakarta, Mikrotrans and angkot route relations near the stations (MapsRide.routesNear). */
  transitRoutes?: (stations: readonly Stations.Station[]) => Effect.Effect<{
    routes: readonly MapsRide.Route[]
    failed: readonly string[]
    errors: readonly string[]
  }>
  /** One short status line for the user while a long run is going. */
  progress?: (text: string) => Effect.Effect<void>
}

/** True when a saved "already applied / rejected" note names this listing (same link, or the same title and company words). */
export function isExcluded(row: { title: string; url: string }, notes: readonly string[]) {
  const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim()
  const link = row.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase()
  const title = plain(row.title)
  return notes.some((note) => {
    if (link.length > 8 && note.toLowerCase().includes(link)) return true
    return title.length >= 12 && plain(note).includes(title)
  })
}

/** One research run: constraints → search → locate → measure → verify → tables. */
export function runDeep(deps: Deps) {
  return (input: DeepInput): Effect.Effect<DeepResult, ToolFailure> =>
    Effect.gen(function* () {
      const constraints = extractConstraints(input.query, input.location ?? input.anchor)
      const scope = scopeOf(input, constraints)
      if (input.category === "job" && deps.searchJobs) return yield* jobs(deps, input, constraints, scope)
      return yield* places(deps, input, constraints, scope)
    })
}

type Scope = { lines: readonly string[]; stations: readonly Stations.Station[]; label: string }

/** Which stations the question is about: named stations, else the lines given or written, else none. */
function scopeOf(input: DeepInput, c: Constraints): Scope | undefined {
  const anchorStation = input.anchor && RAIL_WORD.test(input.anchor) ? Stations.find(input.anchor) : undefined
  const stations = anchorStation ? [anchorStation] : (c.transit?.stations ?? [])
  if (stations.length)
    return { lines: [], stations, label: stations.map((station) => `Stasiun ${station.name}`).join(", ") }
  const given = [...(input.lines ?? []), ...(input.transitLine ? [input.transitLine] : [])]
  if (given.length) {
    const lines = [...new Set(given.flatMap((line) => linesOf(line)))]
    return { lines, stations: [], label: lineLabel(lines) }
  }
  if (!c.transit) return undefined
  return { lines: c.transit.lines, stations: [], label: c.transitLine ?? lineLabel(c.transit.lines) }
}

function jobs(deps: Deps, input: DeepInput, c: Constraints, scope: Scope | undefined) {
  return Effect.gen(function* () {
    const say = (text: string) => (deps.progress ? deps.progress(text) : Effect.void)
    const maxResults = clamp(Math.round(input.maxResults ?? 150), 1, 300)
    const radius = Math.round((input.radiusKm ?? c.radiusKm) * 1000)
    const minSalary = input.minSalary ?? c.minSalary
    const rideScope = (input.accessMode ?? c.accessMode) === "walk_or_one_transit" && scope !== undefined
    const named = JobBoards.cities(input.query, input.location)
    const lines = scope ? (scope.stations.length ? [...new Set(scope.stations.flatMap((station) => station.lines))] : scope.lines) : []
    const fromAnchor = c.anchor ? JobBoards.cities(c.anchor) : []
    const wanted = scope
      ? [...new Set([...JobBoards.lineCities(lines), ...named])]
      : named.length
        ? named
        : fromAnchor
    const defaulted = wanted.length === 0
    const cities = defaulted ? ["jakarta"] : wanted
    const phrases = JobBoards.phrases(input.query, named)
    const searchIn = JobBoards.searchCities(cities)
    const near = !scope && c.anchorKind === "near" && c.anchor && fromAnchor.length === 0 ? c.anchor : undefined
    yield* say(`Mencari "${phrases.join('", "')}" di ${searchIn.join(", ")} (papan lowongan, web, media sosial)…`)

    const notes = deps.excluded ? yield* deps.excluded() : []
    const judge = (listing: JobBoards.Listing, web: boolean): Verdict => {
      if (isExcluded(listing, notes)) return { drop: "excluded" }
      const decision = JobRelevance.classify(listing, phrases, web)
      if ("drop" in decision) return decision
      const known = JobBoards.placesIn(listing.location).length > 0
      if ((known && !JobBoards.inCities(listing, cities)) || JobBoards.basedElsewhere(listing.title, cities)) return { drop: "city" }
      if (minSalary !== undefined && Salary.meets(listing.salary, minSalary) === "no") return { drop: "salary" }
      return { ...listing, level: decision.level }
    }
    const done = { count: 0 }
    // One time budget per call (default 8 min). Office lookups and the career pages of the employers near the stations run
    // from the start, alongside the board searches; whatever is not finished is reported and continued by the next call
    // (offices, websites and board answers are cached).
    const started = Date.now()
    const end = started + Number(process.env.OPENCODE_RESEARCH_BUDGET_MS ?? 480_000)
    const locateEnd = end - 40_000
    const careersEnd = end - 85_000
    const holder: { features: readonly MapsTransit.Feature[]; ready: boolean } = { features: [], ready: false }
    // Employer websites printed by the boards (Kalibrr's company profile), by company key.
    const knownSites = new Map<string, string>()
    const learn = (rows: readonly JobBoards.Listing[]) =>
      rows.forEach((row) => {
        if (row.company && row.website && JobBoards.isOfficialHost(row.website) && !knownSites.has(companyKey(row.company)))
          knownSites.set(companyKey(row.company), row.website)
      })
    // Office location once per company not looked up yet; the station buffer's offices are offered as candidates.
    // Companies named like an office near the stations go first (instant and inside the radius), then those with an address.
    const locateAll = (rows: readonly JobBoards.Listing[], features: readonly MapsTransit.Feature[], known: ReadonlySet<string>) => {
      const nearby = new Set(features.flatMap((feature) => (feature.name ? [companyKey(feature.name)] : [])))
      const groups = [...Map.groupBy(rows.filter((row) => row.company && !known.has(companyKey(row.company))), (row) => companyKey(row.company!))].toSorted(
        ([a, rowsA], [b, rowsB]) =>
          Number(nearby.has(b)) - Number(nearby.has(a)) ||
          Number(rowsB.some((row) => row.address)) - Number(rowsA.some((row) => row.address)),
      )
      return Effect.forEach(
        groups,
        ([key, members]) =>
          Effect.suspend(() => {
            const missed = misses.get(key)
            if (missed && Date.now() - missed.at < MISS_TTL) return Effect.succeed<MapsCompany.Lookup>({ reason: missed.reason })
            if (Date.now() > locateEnd) return Effect.succeed<MapsCompany.Lookup>({ reason: NOT_LOOKED_UP })
            return locate(deps, members, features, locateEnd).pipe(
              Effect.tap((lookup) =>
                Effect.sync(() => {
                  // Reasons that may change on the next call (time budget, a consent page) are not remembered.
                  if (lookup.located || !lookup.reason || TRANSIENT.test(lookup.reason)) return
                  misses.set(key, { at: Date.now(), reason: lookup.reason })
                  if (misses.size > 2000) misses.delete(misses.keys().next().value!)
                }),
              ),
            )
          }).pipe(
            Effect.tap(() => {
              done.count += 1
              return done.count % 25 === 0 ? say(`Lokasi kantor: ${done.count} perusahaan dicek…`) : Effect.void
            }),
            Effect.map((lookup) => [key, lookup] as const),
          ),
        { concurrency: 12 },
      )
    }

    // Office lookups are the slow part (Photon, Nominatim's one request per second, Google Maps pages one at a time), so
    // each board search's employers are looked up as soon as that search finishes, while the other searches keep working.
    const pending: JobBoards.Listing[] = []
    const flow = { reading: 2, quickDone: false }
    const empty = { listings: [], reports: [], manual: [], skipped: [] }
    const boards = (kind: "quick" | "browser") =>
      (deps.board
        ? deps.board({
            phrases,
            cities: searchIn,
            kind,
            onListings: (rows) => {
              learn(rows)
              pending.push(...rows)
            },
          })
        : Effect.succeed(empty)
      ).pipe(
        Effect.tap((result) => Effect.sync(() => learn(result.listings))),
        Effect.ensuring(
          Effect.sync(() => {
            flow.reading -= 1
            if (kind === "quick") flow.quickDone = true
          }),
        ),
      )
    const streamed = Effect.gen(function* () {
      const found: (readonly [string, MapsCompany.Lookup])[] = []
      const known = new Set<string>()
      // The station buffer (seconds) comes first, so companies with an office near a station match it without a request.
      while (scope && deps.nearTransit && !holder.ready && Date.now() - started < 40_000) yield* Effect.sleep("1 second")
      while (flow.reading > 0 || pending.length > 0) {
        const batch = pending.splice(0)
        if (batch.length === 0) {
          yield* Effect.sleep("1 second")
          continue
        }
        const rows = batch.flatMap((listing) => {
          const verdict = judge(listing, false)
          return "drop" in verdict ? [] : [verdict]
        })
        const located = yield* locateAll(rows, holder.features, known)
        located.forEach((entry) => {
          known.add(entry[0])
          found.push(entry)
        })
      }
      return found
    })
    // Career pages of every named employer near the stations, started as soon as the station buffer is known.
    const careerKey = (company: string) => `${companyKey(company)}|${phrases.join(",")}`
    const career = (request: { company: string; phrases: readonly string[]; website?: string }) =>
      Effect.suspend(() => {
        const seen = careerSeen.get(careerKey(request.company))
        if (seen && Date.now() - seen.at < CAREER_TTL) return Effect.succeed(seen.check)
        return !deps.careers
          ? Effect.succeed<JobBoards.Career>({ company: request.company, note: "Pemeriksa halaman karir tidak tersedia", match: "unknown" })
          : Date.now() > careersEnd
            ? Effect.succeed<JobBoards.Career>({ company: request.company, note: NOT_CHECKED, match: "unknown" })
            : deps.careers(request).pipe(
                Effect.timeoutOption("75 seconds"),
                Effect.map(
                  (found): JobBoards.Career =>
                    found._tag === "Some"
                      ? found.value
                      : { company: request.company, ...(request.website ? { url: request.website } : {}), note: "tidak selesai dalam 75 detik", match: "unknown" },
                ),
                Effect.tap((check) =>
                  Effect.sync(() => {
                    careerSeen.set(careerKey(request.company), { at: Date.now(), check })
                    if (careerSeen.size > 2000) careerSeen.delete(careerSeen.keys().next().value!)
                  }),
                ),
              )
      })
    // Website per employer: OSM's tag, else the one a job board printed, else a web search on the name.
    const siteOf = (feature: MapsTransit.Feature) =>
      Effect.gen(function* () {
        // Kalibrr (a quick board, seconds) prints company websites; wait for it before searching the web.
        while (!feature.website && !flow.quickDone && Date.now() - started < 60_000) yield* Effect.sleep("500 millis")
      }).pipe(Effect.andThen((): Effect.Effect<Site | undefined> => {
        if (feature.website) return Effect.succeed({ url: feature.website, from: "osm" })
        const board = knownSites.get(companyKey(feature.name!))
        if (board) return Effect.succeed({ url: board, from: "board" })
        if (Date.now() > careersEnd) return Effect.succeed(undefined)
        return discoverWebsite(deps, feature.name!).pipe(Effect.map((url) => (url ? { url, from: "web" as const } : undefined)))
      }))
    const employerCareers = (features: readonly MapsTransit.Feature[]) =>
      Effect.gen(function* () {
        const employers = employersIn(features)
        const ordered = [...employers.filter((feature) => feature.website), ...employers.filter((feature) => !feature.website)]
          .toSorted((a, b) => Number(careerSeen.has(careerKey(a.name!))) - Number(careerSeen.has(careerKey(b.name!))))
          .slice(0, CAREER_CAP)
        if (ordered.length) yield* say(`Membuka halaman karir ${ordered.length} perusahaan dalam ${radius} m dari stasiun (website dicari bila OSM tidak punya)…`)
        const counter = { done: 0 }
        const results = yield* Effect.forEach(
          ordered,
          (feature) =>
            Effect.gen(function* () {
              const site = yield* siteOf(feature)
              const check = yield* career({ company: feature.name!, phrases, ...(site ? { website: site.url } : {}) })
              counter.done += 1
              if (counter.done % 25 === 0) yield* say(`Halaman karir: ${counter.done}/${ordered.length} dicek…`)
              return [feature.id, { site, check }] as const
            }),
          { concurrency: 5 },
        )
        return new Map(results)
      })
    const bufferAndCareers =
      scope && deps.nearTransit
        ? stationBuffer(deps, scope, radius).pipe(
            Effect.tap((answer) =>
              Effect.sync(() => {
                holder.features = Result.isSuccess(answer) ? answer.success.features : []
                holder.ready = true
              }),
            ),
            Effect.flatMap((answer) => employerCareers(holder.features).pipe(Effect.map((careers) => ({ answer, careers })))),
          )
        : Effect.succeed(undefined)
    const [browser, quick, early, web, bufferRun, anchorPlace, routeRun] = yield* Effect.all(
      [
        boards("browser"),
        boards("quick"),
        streamed,
        webPosts(deps, phrases, searchIn[0]),
        bufferAndCareers,
        near
          ? deps
              .searchPlaces({ query: near, limit: 1, ...(input.location ? { near: input.location } : {}) })
              .pipe(
                Effect.map((found) => found.places.find((place) => place.latitude !== undefined && place.longitude !== undefined)),
                Effect.orElseSucceed(() => undefined),
              )
          : Effect.succeed(undefined),
        // One-ride access: the bus/angkot routes near the stations load while the boards are read.
        rideScope && deps.transitRoutes ? deps.transitRoutes(stationsOf(scope!)).pipe(Effect.map((found) => found as typeof found | undefined)) : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    )
    const buffer = bufferRun?.answer
    const boardResult = {
      listings: [...quick.listings, ...browser.listings],
      reports: [...quick.reports, ...browser.reports],
      manual: [...new Map([...quick.manual, ...browser.manual].map((item) => [item.board, item])).values()],
      skipped: [...(quick.skipped ?? []), ...(browser.skipped ?? [])],
    }
    const transit = buffer && Result.isSuccess(buffer) ? buffer.success : undefined
    const transitError = buffer && Result.isFailure(buffer) ? buffer.failure.message : undefined
    const features = transit?.features ?? []
    const scopeStations = scope ? (transit?.stations ?? stationsOf(scope)) : undefined

    // Web rows become listings too: the posting's JSON-LD when the page has one, else the hit's own text, else the post's page.
    const webListings = web.hits.map((hit, index): JobBoards.Listing => {
      const posting = web.postings.get(hit.url)
      const text = `${hit.title ?? ""}\n${hit.content ?? ""}`
      const place = JobBoards.placesIn(text)[0]
      const salary = posting?.salary ?? salaryIn(hit.content)
      const company = posting?.company ?? JobBoards.companyFromPost(text) ?? web.companies.get(hit.url)
      return {
        id: hit.url || `web-${index}`,
        title: (posting?.title ?? hit.title ?? hit.url).slice(0, 200),
        ...(company ? { company } : {}),
        ...(posting?.location || place ? { location: posting?.location ?? place } : {}),
        ...(posting?.address ? { address: posting.address } : {}),
        ...(posting?.latitude !== undefined && posting.longitude !== undefined
          ? { latitude: posting.latitude, longitude: posting.longitude }
          : {}),
        ...(salary ? { salary } : {}),
        ...(posting?.posted ? { posted: posting.posted } : {}),
        summary: (hit.content ?? "").slice(0, 300),
        url: hit.url,
        board: hit.label,
      }
    })
    const webIds = new Set(webListings.map((listing) => listing.id))

    const all = JobBoards.dedupe([...boardResult.listings, ...webListings])
    learn(boardResult.listings)
    const judged = all.map((listing) => ({ listing, verdict: judge(listing, webIds.has(listing.id)) }))
    const rows = judged.flatMap((entry) => ("drop" in entry.verdict ? [] : [entry.verdict]))
    const dropped = (reason: string) => judged.filter((entry) => "drop" in entry.verdict && entry.verdict.drop === reason).length
    // "network engineer 3, accounting 2": unrelated titles by the rule that dropped them, most first.
    const unrelatedLabels = Object.entries(
      Object.groupBy(
        judged.flatMap((entry) => ("drop" in entry.verdict && entry.verdict.drop === "unrelated" ? [entry.verdict.label ?? "lain"] : [])),
        (label) => label,
      ),
    )
      .map(([label, list]) => [label, list?.length ?? 0] as const)
      .toSorted((a, b) => b[1] - a[1])
    const companies = new Set(rows.flatMap((row) => (row.company ? [companyKey(row.company)] : [])))

    const employers = scope ? employersIn(features) : []
    const employerChecks = bufferRun?.careers ?? new Map<string, { site: Site | undefined; check: JobBoards.Career }>()
    yield* say(
      `Mencari lokasi kantor ${companies.size} perusahaan di peta (${early.length} sudah dicari)${scope ? `; ${employers.length} perusahaan dalam ${radius} m dari stasiun, ${[...employerChecks.values()].filter((entry) => entry.check.note !== NOT_CHECKED).length} halaman karir sudah dicek` : ""}…`,
    )
    const [rest, employerWalks] = yield* Effect.all(
      [
        locateAll(rows, features, new Set(early.map((entry) => entry[0]))),
        scopeStations
          ? stationWalks(
              deps,
              employers.map((feature) => ({
                station: scopeStations.find((station) => station.id === feature.nearest.stationId) ?? scopeStations[0]!,
                to: feature,
              })),
            )
          : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    )
    const lookups = new Map([...early, ...rest].filter((entry) => companies.has(entry[0])))
    const anchorPoint =
      anchorPlace?.latitude !== undefined && anchorPlace.longitude !== undefined
        ? { name: anchorPlace.name, latitude: anchorPlace.latitude, longitude: anchorPlace.longitude }
        : undefined
    const spatial = scopeStations ? "station" : anchorPoint ? "anchor" : undefined
    const offices = [...lookups].flatMap(([key, lookup]) => {
      if (!lookup.located) return []
      const point = { latitude: lookup.located.latitude, longitude: lookup.located.longitude }
      const station = scopeStations
        ? Geo.nearestCentre(point, scopeStations)
        : (() => {
            const closest = Stations.nearest(point, { modes: ["krl", "mrt", "lrt"] })[0]
            return closest ? { centre: closest.station, meters: closest.meters } : undefined
          })()
      const fromAnchor = anchorPoint ? Math.round(Geo.inverse(anchorPoint, point).meters) : undefined
      const straight = spatial === "anchor" ? fromAnchor : station ? Math.round(station.meters) : undefined
      return [{ key, located: lookup.located, point, station, straight }]
    })
    // Walks are measured where they can matter: up to 1.5× the radius in a straight line.
    const walkable = spatial ? offices.filter((office) => office.straight !== undefined && office.straight <= radius * 1.5) : []
    // From stations the walk starts at the station's best access point (entrance, building outline, platform end).
    const walks: readonly (Walked | undefined)[] =
      spatial === "station"
        ? yield* stationWalks(deps, walkable.map((office) => ({ station: office.station!.centre, to: office.point })))
        : deps.walking && walkable.length
          ? yield* deps.walking(walkable.map((office) => ({ from: anchorPoint!, to: office.point })))
          : []
    const walkOf = new Map(walkable.map((office, index) => [office.key, walks[index]]))
    // Reachable on foot without paying: a usable walk within the radius, or, when OSRM still routes oddly, a straight
    // line within 0.7 × the radius ("perkiraan").
    const onFoot = offices.map((office) => {
      const walk = walkOf.get(office.key)
      const reliable = walk && !noteOf(office.straight ?? 0, walk) ? walk : undefined
      const inside =
        !spatial || office.straight === undefined
          ? spatial === undefined
          : reliable
            ? reliable.meters <= radius
            : office.straight <= radius * APPROXIMATE_SHARE
      return { ...office, walk, reliable, inside, approximate: inside && spatial !== undefined && !reliable }
    })
    // One direct bus/angkot ride from a station, for offices not reachable on foot (bus distance up to 15 km).
    const rides =
      rideScope && routeRun && scopeStations && deps.walking
        ? yield* MapsRide.oneRide({
            stations: scopeStations,
            routes: routeRun.routes,
            targets: onFoot
              .filter((office) => !office.inside && office.straight !== undefined && office.straight <= RIDE_REACH)
              .map((office) => ({ key: office.key, point: office.point })),
            stationWalk: (pairs) => stationWalks(deps, pairs),
            walking: deps.walking,
          }).pipe(Effect.tap((found) => say(`Akses 1x naik transum: ${found.size} kantor terhubung satu rute dari stasiun…`)))
        : new Map<string, MapsRide.Ride>()
    const measured = new Map(
      onFoot.map((office) => {
        const ride = office.inside ? undefined : rides.get(office.key)
        return [office.key, { ...office, ...(ride ? { ride } : {}), inside: office.inside || ride !== undefined }] as const
      }),
    )
    const placed = rows.map((row) => {
      const key = row.company ? companyKey(row.company) : undefined
      const office = key ? measured.get(key) : undefined
      const reason = !row.company
        ? webIds.has(row.id)
          ? "postingan tanpa nama perusahaan"
          : "nama perusahaan tidak tercantum di lowongan"
        : office
          ? undefined
          : reasonText(lookups.get(key!)?.reason)
      return { row, office, reason }
    })
    const distance = (entry: (typeof placed)[number]) => entry.office?.reliable?.meters ?? entry.office?.straight ?? Number.MAX_SAFE_INTEGER
    const main = placed
      .filter((entry) => entry.office?.inside)
      .toSorted(
        (a, b) =>
          Number(b.row.level === "tepat") - Number(a.row.level === "tepat") ||
          Number(a.office?.ride !== undefined) - Number(b.office?.ride !== undefined) ||
          distance(a) - distance(b),
      )
    const unlocated = placed.filter((entry) => !entry.office)
    const outside = placed.filter((entry) => entry.office && !entry.office.inside).toSorted((a, b) => distance(a) - distance(b))

    // Without stations, the career pages of the employers in the main table are read instead.
    const jobCompanies = scope ? [] : [...new Set(main.map((entry) => entry.row.company!).filter(Boolean))].slice(0, 10)
    if (jobCompanies.length) yield* say(`Membuka halaman karir ${jobCompanies.length} perusahaan…`)
    const checks = scope
      ? [...employerChecks.values()].map((entry) => entry.check)
      : yield* Effect.forEach(jobCompanies, (company) => career({ company, phrases }), { concurrency: 4 })
    const checked = checks.filter((check) => check.note !== NOT_CHECKED)
    const siteOfEmployer = (feature: MapsTransit.Feature) => employerChecks.get(feature.id)?.site ?? (feature.website ? { url: feature.website, from: "osm" as const } : undefined)

    const checkedAt = Date.now()
    const salaryCell = (salary: string | undefined) => {
      if (!salary) return "tidak dicantumkan"
      return minSalary !== undefined && Salary.meets(salary, minSalary) === "yes" ? `${salary} (≥ ${Salary.short(minSalary)})` : salary
    }
    const shown = main.slice(0, maxResults)
    const table = shown.length
      ? [
          "| # | Posisi | Perusahaan | Kantor (alamat) | Stasiun terdekat | Jarak lurus / jalan kaki | Akses | Gaji | Diposting | Kecocokan | Sumber | Link lamar |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...shown.map(
            (entry, index) =>
              `| ${index + 1} | ${cell(entry.row.title, 90)} | ${cell(entry.row.company, 50)} | ${officeText(entry.office!.located)} | ${cell(stationText(entry.office!.station?.centre), 40)} | ${distanceText(entry.office!, spatial === "anchor" ? anchorPoint?.name : undefined)} | ${accessText(entry.office!)} | ${cell(salaryCell(entry.row.salary), 60)} | ${cell(entry.row.posted, 25)} | ${entry.row.level === "tepat" ? "Tepat" : "Mirip"} | ${cell(entry.row.board, 20)} | [Lamar](${entry.row.url}) |`,
          ),
        ].join("\n")
      : undefined
    const unlocatedShown = unlocated.slice(0, maxResults)
    const unlocatedTable = unlocatedShown.length
      ? [
          "| # | Posisi | Perusahaan | Lokasi di lowongan | Gaji | Sumber | Link | Kenapa lokasi kantor belum ketemu |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...unlocatedShown.map(
            (entry, index) =>
              `| ${index + 1} | ${cell(entry.row.title, 90)} | ${cell(entry.row.company, 50)} | ${cell(entry.row.address ?? entry.row.location, 70)} | ${cell(salaryCell(entry.row.salary), 50)} | ${cell(entry.row.board, 20)} | [Lamar](${entry.row.url}) | ${cell(entry.reason, 140)} |`,
          ),
          ...(unlocated.length > unlocatedShown.length ? [`| … | ${unlocated.length - unlocatedShown.length} baris lagi tidak ditampilkan (batas maxResults) | | | | | | |`] : []),
        ].join("\n")
      : undefined
    const outsideShown = outside.slice(0, maxResults)
    const outsideTable = outsideShown.length
      ? [
          "| # | Posisi — Perusahaan | Stasiun terdekat | Jarak lurus / jalan kaki | Link |",
          "| --- | --- | --- | --- | --- |",
          ...outsideShown.map(
            (entry, index) =>
              `| ${index + 1} | ${cell(`${entry.row.title} — ${entry.row.company}`, 100)} | ${cell(stationText(entry.office!.station?.centre), 30)} | ${distanceText(entry.office!, spatial === "anchor" ? anchorPoint?.name : undefined)} | [Lamar](${entry.row.url}) |`,
          ),
          ...(outside.length > outsideShown.length ? [`| … | ${outside.length - outsideShown.length} baris lagi (batas maxResults) | | | |`] : []),
        ].join("\n")
      : undefined
    const companyTable = employers.length
      ? [
          `| # | Perusahaan | Stasiun terdekat | Jarak lurus / jalan kaki | Website | Karir: posisi relevan? |`,
          "| --- | --- | --- | --- | --- | --- |",
          ...employers.map((feature, index) => {
            const check = employerChecks.get(feature.id)?.check
            const site = siteOfEmployer(feature)
            const walk = employerWalks[index]
            const listed = main.findIndex((entry) => entry.office?.located.osmId === feature.id || entry.office?.key === MapsCompany.normalizeCompany(feature.name!))
            const note = check
              ? check.note === NOT_CHECKED
                ? NOT_CHECKED
                : `${check.match === "yes" ? "Ya" : check.match === "no" ? "Tidak" : "?"}: ${check.note}`
              : `belum dicek (batas ${CAREER_CAP} halaman per panggilan; panggil lagi)`
            const from = site?.from === "board" ? " (dari papan lowongan)" : site?.from === "web" ? " (dari pencarian web)" : ""
            return `| ${index + 1} | ${cell(feature.name, 50)} | ${cell(`${feature.nearest.station} (${feature.nearest.lines.join("/")})`, 30)} | ${walkText(feature.nearest.meters, walk)} | ${site ? `[${cell(hostOf(site.url), 40)}](${site.url})${from}` : "-"} | ${cell(`${note}${listed >= 0 ? ` (lowongan: tabel utama #${listed + 1})` : ""}`, 160)}${check?.url && check.url !== site?.url ? ` [karir](${check.url})` : ""} |`
          }),
        ].join("\n")
      : undefined
    const careerTable = !scope && checks.length
      ? [
          "| Perusahaan | Halaman karir resmi | Hasil dibuka hari ini |",
          "| --- | --- | --- |",
          ...checks.map((check) => `| ${cell(check.company, 50)} | ${check.url ? `[${cell(hostOf(check.url), 40)}](${check.url})` : "-"} | ${cell(check.note, 160)} |`),
        ].join("\n")
      : undefined

    const read = boardResult.reports.reduce((sum, report) => sum + report.count, 0)
    const located = placed.filter((entry) => entry.office).length
    const companiesLocated = [...lookups.values()].filter((lookup) => lookup.located).length
    const notLookedUp = placed.filter((entry) => entry.reason === reasonText(NOT_LOOKED_UP)).length
    const careersLeft = scope ? employers.length - checked.length : 0
    const unfinished = [
      ...(boardResult.skipped?.length ? [`${boardResult.skipped.length} pencarian papan belum jalan`] : []),
      ...(notLookedUp ? [`${notLookedUp} lokasi kantor belum dicari`] : []),
      ...(careersLeft > 0 ? [`${careersLeft} halaman karir belum dicek`] : []),
    ]
    const summary = [
      ...(unfinished.length
        ? [
            `BELUM SELESAI (${unfinished.join(", ")}): call research_deep again with exactly the same input until this line is gone; finished parts are cached, so each call continues where this one stopped.`,
          ]
        : []),
      `Dibaca: ${boardResult.reports.map((report) => `${report.board} ${report.count}`).join(", ") || "tidak ada papan"}; web/media sosial ${web.hits.length} hasil${web.searchPages ? ` (${web.searchPages} halaman pencarian papan dilewati)` : ""}. Total ${read + web.hits.length} listing, ${all.length} unik.`,
      `Cocok dengan posisi ${phrases.map((phrase) => `"${phrase}"`).join(", ")}: ${rows.length} (Tepat ${rows.filter((row) => row.level === "tepat").length}, Mirip ${rows.filter((row) => row.level === "mirip").length}). Dibuang: ${dropped("role")} posisi lain, ${dropped("unrelated")} tidak relevan${unrelatedLabels.length ? ` (${unrelatedLabels.map(([label, count]) => `${label} ${count}`).join(", ")})` : ""}, ${dropped("borderline")} judul ambigu tanpa JD data, ${dropped("city")} kota lain${minSalary !== undefined ? `, ${dropped("salary")} gaji tercantum di bawah ${Salary.short(minSalary)}` : ""}${dropped("excluded") ? `, ${dropped("excluded")} sudah dilamar/ditolak` : ""}.`,
      `Lokasi kantor: ${located} lowongan ketemu (${companiesLocated} dari ${companies.size} perusahaan), ${unlocated.length} belum ketemu (tabel unlocatedTable).`,
      spatial === "station"
        ? `Bisa jalan kaki ≤${radius} m dari ${scope!.label}: ${main.filter((entry) => !entry.office?.ride).length} lowongan (${main.filter((entry) => entry.office?.approximate).length} perkiraan)${rideScope ? `; 1x naik transum langsung dari stasiun: ${main.filter((entry) => entry.office?.ride).length}${routeRun ? ` (${routeRun.routes.length} rute bus/angkot OSM${routeRun.failed.length ? `, ${routeRun.failed.length} stasiun gagal dimuat` : ""})` : " (data rute tidak tersedia)"}` : ""}; tabel utama ${main.length}${main.length > shown.length ? `, ${shown.length} ditampilkan` : ""}; di luar: ${outside.length} (outsideTable).`
        : spatial === "anchor"
          ? `Dalam ${radius} m dari ${anchorPoint!.name}: ${main.length} lowongan; di luar: ${outside.length}.`
          : `Tabel utama: ${main.length} lowongan dengan kantor terlokasi${main.length > shown.length ? ` (${shown.length} ditampilkan)` : ""}.`,
      ...(scope
        ? [
            `Perusahaan bernama dalam ${radius} m dari stasiun (OSM): ${employers.length}; punya website: ${employers.filter((feature) => siteOfEmployer(feature)).length} (OSM ${employers.filter((feature) => feature.website).length}, papan lowongan ${[...employerChecks.values()].filter((entry) => entry.site?.from === "board").length}, pencarian web ${[...employerChecks.values()].filter((entry) => entry.site?.from === "web").length}); halaman karir dicek: ${checked.length}, ada posisi relevan: ${checks.filter((check) => check.match === "yes").length}.`,
          ]
        : []),
    ].join("\n")
    const failures = web.runs.filter((run) => run.error)
    const skipped = boardResult.skipped ?? []
    const candidates = [...shown, ...unlocatedShown].map(
      (entry): Candidate => ({
        id: entry.row.url || entry.row.id,
        category: "job",
        title: entry.row.title.slice(0, 300),
        provider: entry.row.board,
        ...(entry.row.company ? { company: entry.row.company } : {}),
        ...(entry.row.location ? { location: entry.row.location } : {}),
        ...(entry.office?.located.address ?? entry.row.address ? { address: entry.office?.located.address ?? entry.row.address } : {}),
        ...(entry.office ? { latitude: entry.office.point.latitude, longitude: entry.office.point.longitude } : {}),
        url: entry.row.url,
        summary: [entry.row.location, entry.row.salary ?? "gaji tidak dicantumkan", entry.row.posted].filter(Boolean).join(" · "),
        ...(entry.office?.straight !== undefined ? { distanceM: entry.office.straight } : {}),
        ...(entry.office?.ride
          ? { travelMode: "transit" as const, priceNote: accessText(entry.office) }
          : entry.office?.walk
            ? { walkingM: entry.office.walk.meters, travelMode: "walking" as const, travelMinutes: Math.round(entry.office.walk.seconds / 60) }
            : {}),
        ...(entry.office?.station ? { station: entry.office.station.centre.name } : {}),
        ...(spatial === "anchor" && anchorPoint ? { anchor: anchorPoint.name } : {}),
        ...(entry.row.salary ? { salary: entry.row.salary } : {}),
        ...(entry.row.posted ? { posted: entry.row.posted } : {}),
        verified: {
          location: entry.office ? "yes" : "unknown",
          ...(minSalary !== undefined ? { salary: Salary.meets(entry.row.salary, minSalary) } : {}),
        },
        checkedAt,
        source: webIds.has(entry.row.id) ? "web-search" : "scraped",
      }),
    )
    return {
      query: input.query,
      category: input.category,
      providers: [
        ...boardResult.reports.map(
          (report): Provider => ({
            provider: report.board,
            status: report.count > 0 ? "configured" : report.error ? "error" : "unavailable",
            message: `${report.count} listings read${report.searches !== undefined ? ` in ${report.searches} searches` : ""}${report.skipped ? `, ${report.skipped} searches not run (time budget)` : ""}${report.error ? `; error: ${report.error.slice(0, 120)}` : ""}`,
          }),
        ),
        ...web.runs.map(
          (run): Provider => ({
            provider: run.label,
            status: run.error ? "error" : run.count ? "configured" : "unavailable",
            message: run.error ? `failed: ${run.error.slice(0, 200)}` : `${run.count} results for "${run.query}"`,
          }),
        ),
        ...(scope
          ? [
              {
                provider: "openstreetmap",
                status: transit ? ("configured" as const) : ("error" as const),
                message: transit
                  ? `${transit.total} office features within ${radius} m of ${transit.stations.length} stations${transit.notice ? `; ${transit.notice}` : ""}`
                  : `station buffer failed: ${transitError ?? "unavailable"}`,
              },
            ]
          : []),
      ],
      candidates,
      ...(table ? { table } : {}),
      ...(unlocatedTable ? { unlocatedTable } : {}),
      ...(outsideTable ? { outsideTable } : {}),
      ...(companyTable ? { companyTable } : {}),
      ...(careerTable ? { careerTable } : {}),
      summary,
      ...(anchorPoint ? { anchor: anchorPoint } : {}),
      limitations: [
        `Checked ${new Date(checkedAt).toISOString().slice(0, 10)}: job boards, web search and social posts (site: searches), office locations from OpenStreetMap.`,
        "Paste the tables in full in your answer (table, then unlocatedTable, outsideTable and companyTable when present), every row and link unchanged, with the summary counts above them; label each row with its own source board. Never shorten them to a top few, never invent a distance or address the tables do not show.",
        spatial === "station"
          ? `Distances: straight line from the station node to the office on the map, and walking over OSM paths (OSRM foot) from the station's best access point (OSM entrance, station building outline or platform end; the table says which). Rule: the office is reachable on foot without paying — the walk from the best access point is at most ${radius} m; when OSRM's route is still unusable (⚠) only a straight line of at most ${Math.round(radius * APPROXIMATE_SHARE)} m counts, marked "perkiraan" in Akses. ${rideScope ? `One-ride access was asked: an office farther away is also in the table when ONE direct bus/TransJakarta/Mikrotrans/angkot route (OSM route relation, stop order not checked) stops within ${MapsRide.BOARD_METERS} m walk of a station access point and within ${MapsRide.ALIGHT_METERS} m walk of the office; Akses shows "1x <route>" with the boarding and alighting stops and both walks. Fares are not free; say so. ` : ""}Offices beyond are in outsideTable. Stations: ${scope!.label}.`
          : spatial === "anchor"
            ? `Distances are measured from ${anchorPoint!.name} (${anchorPoint!.latitude.toFixed(5)}, ${anchorPoint!.longitude.toFixed(5)}); radius ${radius} m.`
            : near
              ? `The place "${near}" could not be found on the map, so listings are not filtered by distance.`
              : "No station or place was named, so listings are not filtered by distance; the nearest KRL/MRT/LRT station is shown for each office.",
        "Office locations: OSM office, building or brand named like the company, or the address in the listing. Kantor column marks: [pasti] exact office, [cukup yakin] head-office tower or several branches, [perkiraan] address or partial name only — say so when quoting it.",
        minSalary !== undefined
          ? `Salary floor ${Salary.short(minSalary)}/bulan: a listing is dropped only when its disclosed salary stays below it; listings without a salary are kept and say "tidak dicantumkan".`
          : "No salary floor was asked.",
        ...(defaulted ? ["No city was named, so the boards were searched in Jakarta."] : []),
        ...(skipped.length
          ? [`${skipped.length} board searches were not run because this call's time budget ran out (${summarizeSkipped(skipped)}); call again to read them (finished searches are cached for an hour).`]
          : []),
        ...(boardResult.manual.length
          ? [`Not readable automatically (they block automated visits); give the user these search links: ${boardResult.manual.map((item) => `${item.board} ${item.url}`).join("; ")}.`]
          : []),
        ...(failures.length ? [`Web search failed for ${failures.map((run) => run.label).join(", ")} (${failures[0]!.error!.slice(0, 160)}); say so.`] : []),
        ...(rideScope && routeRun?.failed.length
          ? [`Bus/angkot routes could not be loaded near ${routeRun.failed.length} stations (${routeRun.errors.join("; ").slice(0, 160)}); one-ride access there is missing, call again (answers are cached).`]
          : []),
        ...(transitError ? [`The station buffer (offices near the stations) failed: ${transitError}. Distances still come from the bundled station list.`] : []),
        ...(transit?.notice ? [transit.notice] : []),
        ...(placed.some((entry) => entry.reason === reasonText(NOT_LOOKED_UP))
          ? [`${placed.filter((entry) => entry.reason === reasonText(NOT_LOOKED_UP)).length} listings' offices were not looked up because this call's time budget ran out; call research_deep again with the same input to continue (offices already found are cached).`]
          : []),
        ...(phrases.length === 0 ? ["No job title was recognised in the question, so the boards had no role to search; ask which role the user wants."] : []),
        ...(rows.length === 0 ? ["No matching listings were found. Say so and suggest a broader query; do not invent any."] : []),
      ],
      checkedAt,
    } satisfies DeepResult
  })
}

type Verdict =
  | { drop: "excluded" | "role" | "unrelated" | "borderline" | "city" | "salary"; label?: string }
  | (JobBoards.Listing & { level: "tepat" | "mirip" })

/** The lookup's reasons in short Indonesian for the table: which step failed. */
function reasonText(reason: string | undefined) {
  if (!reason) return "pencarian lokasi kantor tidak tersedia"
  const partial = reason.match(/the only map match is "([^"]+)"/)?.[1]
  const steps = [
    partial ? `di peta hanya ada "${partial}" (nama cuma mirip sebagian)` : undefined,
    /no OSM office/.test(reason) ? "nama perusahaan tidak ada di OSM" : undefined,
    /could not be geocoded/.test(reason) ? "alamat di lowongan tidak ketemu di peta" : undefined,
    /no office address was given/.test(reason) ? "lowongan tanpa alamat" : undefined,
    /no office address found by web search/.test(reason) ? "alamat kantor tidak ditemukan di web" : undefined,
    /from web search could not be placed/.test(reason) ? "alamat dari web tidak ketemu di peta" : undefined,
    /no Google Maps place/.test(reason) ? "tidak ada di Google Maps dengan nama mirip" : undefined,
    /Google Maps asked for consent/.test(reason) ? "Google Maps minta consent/captcha (tidak dilewati)" : undefined,
    /Google Maps not tried/.test(reason) ? "Google Maps belum dicoba (batas waktu; panggil lagi)" : undefined,
    reason === NOT_LOOKED_UP ? "belum dicari: batas waktu panggilan ini habis (panggil lagi, hasil tersimpan)" : undefined,
  ].filter(Boolean)
  return steps.length ? steps.join("; ") : reason
}

function companyKey(company: string) {
  return MapsCompany.normalizeCompany(company) || company.toLowerCase()
}

/**
 * Offices within the radius of the stations. Overpass often answers 504 under load and the buffer then misses station
 * groups; answered groups are cached, so one more call (while the browser boards are still reading) fetches only the
 * missing ones. The better of the two answers is kept.
 */
function stationBuffer(deps: Deps, scope: Scope, radius: number) {
  return Effect.gen(function* () {
    const once = () => deps.nearTransit!({ ...scopeInput(scope), radiusMeters: radius, kind: "office" }).pipe(Effect.result)
    const first = yield* once()
    const partial = Result.isFailure(first) || /failed/i.test(first.success.notice ?? "")
    if (!partial) return first
    const second = yield* once()
    return Result.isSuccess(second) || Result.isFailure(first) ? second : first
  })
}

/** The office of one company: coordinates from the posting's JSON-LD, else the map lookup, else an address on the web. */
function locate(deps: Deps, members: readonly JobBoards.Listing[], features: readonly MapsTransit.Feature[], deadlineAt: number) {
  const first = members[0]!
  const posted = members.find((member) => member.latitude !== undefined && member.longitude !== undefined)
  if (posted)
    return Effect.succeed<MapsCompany.Lookup>({
      located: {
        name: first.company!,
        latitude: posted.latitude!,
        longitude: posted.longitude!,
        ...(posted.address ? { address: posted.address } : {}),
        source: "address",
        confidence: "high",
        note: "coordinates from the posting's structured data (JSON-LD)",
      },
    })
  if (!deps.locateCompany) return Effect.succeed<MapsCompany.Lookup>({ reason: "office lookup is not available" })
  const address = members.find((member) => member.address)?.address
  const hint = members.map((member) => member.location).find(Boolean)
  // A city hint outside Jabodetabek moves the search box; inside it (or when the address says Jakarta) the default box is right.
  const inside = [...JobBoards.placesIn(address), ...JobBoards.placesIn(hint)].some((place) => JABODETABEK.has(place))
  const cityHint = hint && !inside && JobBoards.placesIn(hint).length ? hint : undefined
  const lookup = deps
    .locateCompany({
      name: first.company!,
      ...(cityHint ? { cityHint } : {}),
      ...(address ? { address } : {}),
      ...(features.length ? { candidates: features } : {}),
      ...(JobBoards.placesIn(hint)[0] ? { place: JobBoards.placesIn(hint)[0] } : {}),
      deadlineAt,
    })
    .pipe(Effect.map(trusted))
  if (!deps.searchJobs) return lookup
  return lookup.pipe(Effect.flatMap((found) => (found.located ? Effect.succeed(found) : addressOnWeb(deps, first.company!, found.reason))))
}

/** A low-confidence match by name ("Cetak Tiket" for tiket.com) is a different place, not an approximate office. */
function trusted(found: MapsCompany.Lookup): MapsCompany.Lookup {
  const located = found.located
  if (!located || located.confidence !== "low") return found
  const byAddress = located.source === "address" || (located.source === "cache" && /^cached address/.test(located.note ?? ""))
  if (byAddress) return found
  return { reason: `the only map match is "${located.name}", which only partly matches the company name` }
}

/**
 * Most employers on the boards are not in OSM by name and the boards give no street. Their office address often is in
 * search snippets ("Alamat: Jl. … Jakarta Selatan 12190"); it is placed on the map as an approximate position.
 */
function addressOnWeb(deps: Deps, company: string, reason: string | undefined) {
  return Effect.gen(function* () {
    const tokens = JobBoards.companyTokens(company)
    const web = yield* deps.searchJobs!({ query: `${company} alamat kantor`, limit: 8, exact: true }).pipe(
      Effect.orElseSucceed(() => ({ results: [] as WebHit[] })),
    )
    const address = web.results
      .filter((hit) => tokens.some((token) => `${hit.title ?? ""} ${hit.content ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(token)))
      .map((hit) => `${hit.title ?? ""}\n${hit.content ?? ""}`.match(ADDRESS)?.[0]?.replace(/\s+/g, " ").trim())
      .find((text): text is string => !!text)
    if (!address) return { reason: `${reason ?? "not found on the map"}; no office address found by web search` } satisfies MapsCompany.Lookup
    const place = deps.geocode
      ? yield* deps.geocode(address)
      : yield* deps.searchPlaces({ query: address, limit: 1 }).pipe(
          Effect.map((found) => found.places.find((item) => item.latitude !== undefined && item.longitude !== undefined)),
          Effect.orElseSucceed(() => undefined),
        )
    if (!place)
      return { reason: `${reason ?? "not found on the map"}; the address "${address}" from web search could not be placed` } satisfies MapsCompany.Lookup
    return {
      located: {
        name: company,
        latitude: place.latitude!,
        longitude: place.longitude!,
        address,
        source: "address",
        confidence: "low",
        note: `address from web search, placed at "${place.name}" (street or building level)`,
      },
    } satisfies MapsCompany.Lookup
  })
}

/**
 * Web and social posts: one general job search and one site: search per network, for the main role phrase; runs
 * alongside the board searches.
 */
function webPosts(deps: Deps, phrases: readonly string[], where: string | undefined) {
  return Effect.gen(function* () {
    const search = deps.searchJobs!
    const main = phrases[0] ?? ""
    const place = where ?? ""
    const queries = [
      { label: "web", query: `${main} ${place}`.trim(), exact: false },
      ...SITES.map((site) => ({ label: site.label, query: `site:${site.domain} lowongan ${main} ${place}`.trim(), exact: true })),
    ]
    const runs = yield* Effect.forEach(
      queries,
      (item) =>
        search({ query: item.query, limit: 30, exact: item.exact }).pipe(
          Effect.result,
          Effect.map((answer) => ({
            ...item,
            results: Result.isSuccess(answer) ? answer.success.results : [],
            error: Result.isSuccess(answer) ? answer.success.error : (answer.failure.message ?? String(answer.failure)),
          })),
        ),
      { concurrency: 2 },
    )
    const seen = new Set<string>()
    const unique = runs.flatMap((run) =>
      run.results.flatMap((hit) => {
        if (!hit.url || seen.has(hit.url)) return []
        seen.add(hit.url)
        return [{ ...hit, label: run.label === "web" ? `web: ${hostOf(hit.url)}` : run.label }]
      }),
    )
    // "1.000+ Lowongan Data Analyst Jakarta" is a board's search page, not one job; the boards are read directly.
    const hits = unique.filter((hit) => !SEARCH_PAGE.test(hit.url) && !/^\s*\d[\d.,]*\+?\s/.test(hit.title ?? ""))
    // Pages that are not social posts are opened for their JobPosting JSON-LD (company, address, coordinates).
    // Social posts whose title and snippet name no employer are opened too: the post text often does ("di PT X").
    const nameless = hits.filter((hit) => SOCIAL.test(hit.url) && !JobBoards.companyFromPost(`${hit.title ?? ""}\n${hit.content ?? ""}`)).slice(0, 15)
    const pages = yield* Effect.forEach(
      [...hits.filter((hit) => !SOCIAL.test(hit.url)).slice(0, 12), ...nameless],
      (hit) => readPage(deps, hit.url).pipe(Effect.map((text) => [hit.url, text] as const)),
      { concurrency: 4 },
    )
    const postings = new Map(pages.map(([url, text]) => [url, ScrapeExtract.postingsFromText(text)[0]] as const))
    const companies = new Map(
      pages.flatMap(([url, text]) => {
        const company = text ? JobBoards.companyFromPost(text.slice(0, 4000)) : undefined
        return company ? [[url, company] as const] : []
      }),
    )
    return {
      hits,
      searchPages: unique.length - hits.length,
      postings,
      companies,
      runs: runs.map((run) => ({
        label: run.label,
        query: run.query,
        count: run.results.length,
        ...(run.error && run.results.length === 0 ? { error: run.error } : {}),
      })),
    }
  })
}

function places(deps: Deps, input: DeepInput, c: Constraints, scope: Scope | undefined) {
  return Effect.gen(function* () {
    const limit = clamp(Math.round(input.maxResults ?? 20), 1, 50)
    const explicit = input.radiusKm !== undefined || c.radiusExplicit
    const radius = Math.round((input.radiusKm ?? c.radiusKm) * 1000)
    const kind = c.kind ?? (input.category === "hotel" ? ("hotel" as const) : undefined)
    const travelMode = input.travelMode ?? c.travelMode
    const anchorText = input.anchor ?? c.anchor ?? input.location
    const notes: string[] = []
    const viaTransit = scope && kind && deps.nearTransit ? yield* nearStations(deps, scope, kind, radius, explicit, notes) : undefined
    const found = viaTransit
      ? undefined
      : yield* deps.searchPlaces({
          query: kind && input.category === "hotel" && c.kind === undefined ? `hotel ${input.query}` : input.query,
          ...(anchorText ? { near: scope?.stations[0] ? `Stasiun ${scope.stations[0].name}` : anchorText } : {}),
          limit,
          ...(explicit || scope ? { radiusKm: radius / 1000 } : {}),
        })
    if (found?.notice) notes.push(found.notice)
    const center = found?.center
    const stationById = new Map(Stations.list({ modes: ["krl", "mrt", "lrt"] }).map((station) => [station.id, station]))
    const corridor = scope && !viaTransit ? stationsOf(scope) : undefined
    const rows: PlaceRow[] = viaTransit
      ? viaTransit.map((feature) => ({
          id: feature.id,
          name: feature.name ?? feature.id,
          category: feature.category.replace("=", ": "),
          address: feature.address,
          latitude: feature.latitude,
          longitude: feature.longitude,
          website: feature.website,
          url: `https://www.openstreetmap.org/${feature.id.replace(/^osm:/, "")}`,
          distanceM: feature.nearest.meters,
          station: feature.nearest.station,
          stationPoint: stationById.get(feature.nearest.stationId),
        }))
      : (found?.places ?? []).flatMap((place) => {
          const row = {
            id: place.id,
            name: place.name,
            category: place.category,
            address: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
            website: place.website,
            url: place.googleMapsUrl ?? place.url,
            distanceM: place.distanceM,
          }
          if (!corridor) return [row]
          // A name search near stations keeps only what lies within the radius of one of them.
          const station =
            place.latitude !== undefined && place.longitude !== undefined
              ? Geo.nearestCentre({ latitude: place.latitude, longitude: place.longitude }, corridor)
              : undefined
          if (!station || station.meters > radius) return []
          return [{ ...row, distanceM: Math.round(station.meters), station: station.centre.name, stationPoint: station.centre }]
        })
    if (corridor && found && rows.length < found.places.length)
      notes.push(`${found.places.length - rows.length} map results farther than ${radius} m from ${scope!.label} were left out.`)
    const limited = rows.slice(0, limit)
    // Must-haves are read on the place's own website: "yes" when it says so, dropped only when it says the opposite.
    const must = [...new Set([...c.must, ...(input.must ?? [])])]
    const pages = must.length
      ? new Map(
          yield* Effect.forEach(
            limited.filter((row) => row.website),
            (row) => readPage(deps, row.website!).pipe(Effect.map((text) => [row.id, text] as const)),
            { concurrency: 4 },
          ),
        )
      : new Map<string, string>()
    const checked = limited.map((row) => {
      const page = pages.get(row.id) ?? ""
      const verified = Object.fromEntries(
        must.map((key) => [key, !page ? "unknown" : mustNegated(key).test(page) ? "no" : mustPattern(key).test(page) ? "yes" : "unknown"] as const),
      )
      return { ...row, verified }
    })
    const kept = checked
      .filter((row) => !Object.values(row.verified).includes("no"))
      .toSorted((a, b) => Object.values(b.verified).filter((value) => value === "yes").length - Object.values(a.verified).filter((value) => value === "yes").length)
    const origin = (row: PlaceRow) => row.stationPoint ?? (center ? { latitude: center.latitude, longitude: center.longitude } : undefined)
    const walkable = travelMode === "walking" && deps.walking ? kept.filter((row) => origin(row) && row.latitude !== undefined && row.longitude !== undefined) : []
    const walks: readonly (Walked | undefined)[] = !walkable.length
      ? []
      : walkable.every((row) => row.stationPoint)
        ? yield* stationWalks(deps, walkable.map((row) => ({ station: row.stationPoint!, to: { latitude: row.latitude!, longitude: row.longitude! } })))
        : yield* deps.walking!(walkable.map((row) => ({ from: origin(row)!, to: { latitude: row.latitude!, longitude: row.longitude! } })))
    const walkOf = new Map(walkable.map((row, index) => [row.id, walks[index]]))
    const checkedAt = Date.now()
    const provider = viaTransit ? "openstreetmap (Overpass, around stations)" : found?.provider === "scraped" ? "scraped" : "openstreetmap"
    const table = kept.length
      ? [
          `| # | Nama | Kategori | Alamat | ${viaTransit ? "Stasiun terdekat | " : ""}Jarak${travelMode === "walking" ? " lurus / jalan kaki" : ""} | Website | ${must.length ? "Syarat (dari website) | " : ""}Peta |`,
          `| --- | --- | --- | --- | ${viaTransit ? "--- | " : ""}--- | --- | ${must.length ? "--- | " : ""}--- |`,
          ...kept.map((row, index) => {
            const walk = walkOf.get(row.id)
            const distance = row.distanceM === undefined ? "-" : walkText(row.distanceM, walk, travelMode === "walking")
            return `| ${index + 1} | ${cell(row.name, 60)} | ${cell(row.category, 30)} | ${cell(row.address, 70)} | ${viaTransit ? `${cell(row.station, 30)} | ` : ""}${distance} | ${row.website ? `[${cell(hostOf(row.website), 40)}](${row.website})` : "-"} | ${must.length ? `${cell(Object.entries(row.verified).map(([key, value]) => `${key}: ${value}`).join(", "), 60)} | ` : ""}${row.url ? `[peta](${row.url})` : "-"} |`
          }),
        ].join("\n")
      : undefined
    const dropped = checked.length - kept.length
    return {
      query: input.query,
      category: input.category,
      providers: [{ provider, status: "configured" as const }],
      candidates: kept.map(
        (row): Candidate => ({
          id: row.id,
          category: input.category,
          title: row.name.slice(0, 300),
          provider,
          ...(row.address ? { location: row.address, address: row.address } : {}),
          ...(row.latitude !== undefined && row.longitude !== undefined ? { latitude: row.latitude, longitude: row.longitude } : {}),
          ...(row.url ? { url: row.url } : {}),
          summary: [row.category, row.address, row.station ? `dekat ${row.station}` : undefined, row.distanceM !== undefined ? `${row.distanceM} m` : undefined].filter(Boolean).join(" · "),
          ...(row.distanceM !== undefined ? { distanceM: row.distanceM } : {}),
          ...(walkOf.get(row.id) ? { walkingM: walkOf.get(row.id)!.meters, travelMinutes: Math.round(walkOf.get(row.id)!.seconds / 60) } : {}),
          ...(row.station ? { station: row.station } : {}),
          ...(anchorText ? { anchor: scope?.label ?? anchorText } : {}),
          travelMode,
          verified: row.verified,
          checkedAt,
          source: found?.provider === "scraped" ? "scraped" : "openstreetmap",
        }),
      ),
      ...(table ? { table } : {}),
      ...(center ? { anchor: { name: center.name ?? anchorText ?? "", latitude: center.latitude, longitude: center.longitude } } : {}),
      summary: `${kept.length} ${kind ?? "places"} shown${rows.length > limit ? ` of ${rows.length} found (maxResults ${limit})` : ""}${dropped ? `; ${dropped} dropped because their website says a must-have is missing` : ""}.`,
      limitations: [
        `Checked ${new Date(checkedAt).toISOString().slice(0, 10)} via ${provider}.`,
        viaTransit
          ? `Every ${kind} within ${radius} m (straight line) of ${scope!.label}, nearest first.`
          : kind
            ? `Category search by OpenStreetMap tag (${kind}) around ${center?.name ?? anchorText ?? "the place"}${found?.radiusMeters !== undefined ? ` within ${found.radiusMeters} m` : ""}.`
            : `Name search on OpenStreetMap${anchorText ? ` near ${anchorText}` : ""}.`,
        ...notes,
        must.length
          ? `Must-haves (${must.join(", ")}) were read on each place's own website: yes = it says so, unknown = no website or not mentioned (kept), no = it says the opposite (dropped).`
          : "No must-have attributes were asked.",
        ...(input.budget !== undefined
          ? [`Budget ${Salary.short(input.budget)}: OpenStreetMap has no prices, so the budget could not be checked; tell the user to compare prices on the booking site.`]
          : []),
        "Free sources have no live date-specific price, availability or ratings; say unknown for those.",
        ...(table ? ["Paste the table in full with its links."] : ["Nothing was found; say so and suggest a wider radius or another place."]),
      ],
      checkedAt,
    } satisfies DeepResult
  })
}

type PlaceRow = {
  id: string
  name: string
  category?: string
  address?: string
  latitude?: number
  longitude?: number
  website?: string
  url?: string
  distanceM?: number
  station?: string
  stationPoint?: Stations.Station
}

/** Features of a kind around the stations; a single named station without a radius is widened to 3 km when empty. */
function nearStations(deps: Deps, scope: Scope, kind: MapsCategory.Kind, radius: number, explicit: boolean, notes: string[]) {
  return Effect.gen(function* () {
    const search = (meters: number) => deps.nearTransit!({ ...scopeInput(scope), radiusMeters: meters, kind }).pipe(Effect.result)
    const first = yield* search(radius)
    const widen = Result.isSuccess(first) && !first.success.features.length && !explicit && scope.stations.length > 0 && radius < 3000
    const answer = widen ? yield* search(3000) : first
    if (Result.isFailure(answer)) {
      notes.push(`The search around the stations failed (${answer.failure.message}); these are map search results near the station instead.`)
      return undefined
    }
    if (widen) notes.push(`Nothing within ${radius} m, so the search was widened to 3000 m.`)
    if (answer.success.notice) notes.push(answer.success.notice)
    const named = answer.success.features.filter((feature) => feature.name)
    const unnamed = answer.success.features.length - named.length
    if (unnamed) notes.push(`${unnamed} unnamed features were left out.`)
    return named
  })
}

/** Named employers among office features (not government, NGO, RW or embassy offices), one row per company. */
function employersIn(features: readonly MapsTransit.Feature[]) {
  const named = features.filter((feature) => {
    const tags = feature.tags
    if (!feature.name || NOT_EMPLOYER.has(tags.office ?? "")) return false
    const linked = !!(feature.website || tags.brand || tags.operator)
    // "PT Maju Jaya" on a plain office=yes or office building is a company too.
    const legal = /(^|[^\p{L}])(pt|cv|tbk|persero)([^\p{L}]|$)/iu.test(feature.name)
    const office = tags.office !== undefined || tags.building === "office" || tags.building === "commercial"
    return EMPLOYER.has(tags.office ?? "") || tags.building === "company" || (office && (linked || legal))
  })
  return named.filter(
    (feature, index) =>
      named.findIndex((other) => MapsCompany.normalizeCompany(other.name!) === MapsCompany.normalizeCompany(feature.name!)) === index,
  )
}

function scopeInput(scope: Scope): Pick<MapsTransit.Input, "lines" | "stations" | "modes"> {
  if (scope.stations.length)
    return { stations: scope.stations.map((station) => `${station.mode === "krl" ? "Stasiun" : station.mode.toUpperCase()} ${station.name}`), modes: [...new Set(scope.stations.map((station) => station.mode))] }
  return { lines: scope.lines }
}

function stationsOf(scope: Scope) {
  return scope.stations.length ? scope.stations : Stations.list({ lines: scope.lines })
}

function lineLabel(lines: readonly string[]) {
  const krl = Stations.LINES.filter((line) => line.mode === "krl").map((line) => line.id)
  if (krl.every((id) => lines.includes(id)) && lines.length === krl.length) return "KRL semua jalur"
  return lines.map((id) => Stations.LINES.find((line) => line.id === id)?.name.replace(/^KRL Commuter Line/, "KRL") ?? id).join(", ")
}

function stationText(station: Stations.Station | undefined) {
  return station ? `${station.name} (${station.mode.toUpperCase()} ${station.lines.join("/")})` : "-"
}

function officeText(located: MapsCompany.Located) {
  const mark = located.confidence === "high" ? "pasti" : located.confidence === "medium" ? "cukup yakin" : "perkiraan"
  const place = located.address ? `${located.name}, ${located.address}` : located.name
  return `${cell(place, 80)} [${mark}]`
}

function distanceText(office: { straight?: number; walk?: Walked }, from: string | undefined) {
  if (office.straight === undefined) return "-"
  return `${walkText(office.straight, office.walk)}${from ? ` dari ${cell(from, 30)}` : ""}`
}

function walkText(straight: number, walk: Walked | undefined, show = true) {
  if (!show) return `${straight} m`
  if (!walk) return `${straight} m / -`
  const odd = noteOf(straight, walk) ? " ⚠ rute OSRM melenceng" : ""
  const start = walk.from && walk.from !== "node" ? ` dari ${START[walk.from]}` : ""
  return `${straight} m / ${walk.meters} m${start} (${Math.max(1, Math.round(walk.seconds / 60))} mnt)${odd}`
}

/** "jalan kaki", "jalan kaki (perkiraan)" or "1x Transjakarta 1B (naik …, turun …; jalan … m + … m)". */
function accessText(office: { approximate?: boolean; ride?: MapsRide.Ride }) {
  if (office.ride) return cell(MapsRide.rideText(office.ride), 160)
  return office.approximate ? "jalan kaki (perkiraan, rute OSRM tidak usable)" : "jalan kaki"
}

/** A walk from a station access point carries its own note; other walks are judged against the straight line. */
function noteOf(straight: number, walk: Walked) {
  return walk.from ? walk.note : MapsTransit.walkingNote(straight, walk)
}

/** Walks from the station's access points; without that dependency, plain walks from the station node. */
function stationWalks(deps: Deps, pairs: readonly { station: Stations.Station; to: Geo.Point }[]): Effect.Effect<readonly (Walked | undefined)[]> {
  if (!pairs.length) return Effect.succeed([])
  if (deps.stationWalking) return deps.stationWalking(pairs)
  if (deps.walking) return deps.walking(pairs.map((pair) => ({ from: pair.station, to: pair.to })))
  return Effect.succeed(pairs.map(() => undefined))
}

type Walked = MapsTransit.Walk & { from?: MapsAccess.Kind; note?: string; straight?: number }

const START: Record<Exclude<MapsAccess.Kind, "node">, string> = { entrance: "pintu masuk", building: "gedung stasiun", platform: "ujung peron" }
// Without a usable walking route, an office counts on foot only within this share of the radius in a straight line.
const APPROXIMATE_SHARE = 0.7
// Offices farther than this from every station are not checked for a one-ride connection.
const RIDE_REACH = 15_000

function summarizeSkipped(skipped: readonly Boards.Search[]) {
  const counts = Object.entries(Object.groupBy(skipped, (search) => search.board)).map(([board, list]) => `${board} ${list?.length ?? 0}`)
  return counts.join(", ")
}

/** The salary part of a snippet ("Gaji Rp 8-10 juta"), when it has rupiah amounts. */
function salaryIn(text: string | undefined) {
  const part = text?.match(/(?:gaji|salary|rp\.?|idr)[^\n.]{0,60}/i)?.[0]
  return part && Salary.parse(part) ? part.trim() : undefined
}

/** A page's text, or "" when it cannot be read within 45 s (one slow site must not hold up the whole run). */
function readPage(deps: Deps, url: string) {
  return deps.scrape(url).pipe(
    Effect.timeoutOption("45 seconds"),
    Effect.map((page) => (page._tag === "Some" ? page.value.text : "")),
  )
}

function hostOf(url: string) {
  return URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url
}

function cell(value: string | undefined, max = 120) {
  const text = (value ?? "-").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "-"
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const RAIL_WORD = /stasiun|station|\bst\.|\bkrl\b|\bmrt\b|\blrt\b/i
// An Indonesian office address up to its city or postal code: "Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan 12190".
const ADDRESS =
  /(?<![\p{L}])(?:Jl\.?|Jln\.?|Jalan|Gedung|Gd\.|Menara|Wisma|Graha|Plaza|Ruko|Komplek|Kompleks|Kawasan)\s[^\n|•<>]{4,140}?(?:\b\d{5}\b|(?:Jakarta(?:\s(?:Pusat|Selatan|Barat|Timur|Utara))?|Tangerang(?:\sSelatan)?|Bekasi|Depok|Bogor|Banten)(?:,?\s+\d{5}\b)?)/iu
// Every employer near the stations is checked within the time budget; this only bounds a pathological buffer.
const CAREER_CAP = Number(process.env.OPENCODE_CAREERS_CAP ?? 400)
const NOT_CHECKED = "belum dicek (batas waktu panggilan ini habis; panggil lagi)"
// Lookup reasons that can change on the next call: not remembered as misses.
const TRANSIENT = /time budget|consent|captcha|unreadable/i
const WEBSITE_TTL = 7 * 24 * 60 * 60 * 1000
const WEBSITE_MISS_TTL = 2 * 24 * 60 * 60 * 1000

type Site = { url: string; from: "osm" | "board" | "web" }

/**
 * The company's own website by web search on its name, when neither OSM nor a job board gave one: the first hit whose
 * registrable domain carries the company name and is not a job board, aggregator, social network or repository
 * (JobBoards.acceptWebsite). Cached a week (misses two days) in the maps cache.
 */
function discoverWebsite(deps: Deps, company: string) {
  return Effect.gen(function* () {
    const key = companyKey(company)
    const cached = yield* Effect.promise(() => MapsOsm.cache.get<{ url?: string }>("website", key, WEBSITE_TTL))
    if (cached?.fresh && cached.value.url) return cached.value.url
    const miss = yield* Effect.promise(() => MapsOsm.cache.get<{ url?: string }>("website", key, WEBSITE_MISS_TTL))
    if (miss?.fresh && !miss.value.url) return undefined
    if (!deps.searchJobs) return undefined
    for (const query of [`"${company}" official website`, `${company} karir`]) {
      const web = yield* deps.searchJobs({ query, limit: 8, exact: true }).pipe(Effect.orElseSucceed(() => ({ results: [] as WebHit[] })))
      const accepted = web.results.filter((hit) => JobBoards.acceptWebsite(hit.url, company)).map((hit) => `${new URL(hit.url).origin}/`)
      for (const url of accepted) {
        // fork: search hits are untrusted; a name resolving to a private address is never offered as the website.
        const safe = yield* Effect.promise(() => NetGuard.assertPublicUrl(url).then(() => true, () => false))
        if (!safe) continue
        MapsOsm.cache.set("website", key, { url })
        return url
      }
    }
    MapsOsm.cache.set("website", key, {})
    return undefined
  })
}
// Career pages read in this process, reused for a few hours so a repeated call moves on to the employers not read yet.
const careerSeen = new Map<string, { at: number; check: JobBoards.Career }>()
const CAREER_TTL = 6 * 60 * 60 * 1000
// Companies the map lookup could not place, remembered for half an hour in this process: a second call (to continue after
// the time budget) spends its time on companies not tried yet. Found offices are cached on disk by MapsCompany.
const misses = new Map<string, { at: number; reason: string }>()
const MISS_TTL = 30 * 60 * 1000
const NOT_LOOKED_UP = "not looked up: this call's time budget ran out"
const SITES = [
  { domain: "linkedin.com/posts", label: "LinkedIn post" },
  { domain: "instagram.com", label: "Instagram" },
  { domain: "facebook.com", label: "Facebook" },
  { domain: "x.com", label: "X" },
]
const SEARCH_PAGE =
  /linkedin\.com\/jobs\/(?!view\/)|jobstreet\.[a-z.]+\/(?:id\/)?(?:[^/]+-jobs|jobs)(?:[/?]|$)|glints\.com\/id\/(?:lowongan-kerja|opportunities\/jobs\/explore)|indeed\.com\/(?:q-|jobs\?)|kalibrr\.com\/(?:[a-z-]+\/)?home|loker\.id\/cari-lowongan|karir\.com\/search|kitalulus\.com\/lowongan\/(?!detail)|dealls\.com\/loker(?:\/?$|\?)/i
const SOCIAL = /linkedin\.com\/(posts|feed|pulse)|instagram\.com|facebook\.com|(^|\/\/|\.)x\.com|twitter\.com|threads\.net|tiktok\.com/i
const JABODETABEK = new Set([
  "jakarta", "jakarta pusat", "jakarta selatan", "jakarta barat", "jakarta timur", "jakarta utara", "tangerang", "tangerang selatan",
  "kabupaten tangerang", "bekasi", "kabupaten bekasi", "depok", "bogor", "kabupaten bogor", "cikarang", "serpong", "bsd", "cisauk",
  "pagedangan", "parungpanjang", "tigaraksa", "citayam", "bojonggede", "cibinong", "cilebut", "tambun", "cibitung", "ciputat",
  "pamulang", "bintaro", "alam sutera", "karawaci", "cikupa", "balaraja",
])
// office=* values that are employers; government, NGO, RW, embassy and religious offices are not.
const EMPLOYER = new Set([
  "company", "it", "financial", "insurance", "consulting", "telecommunication", "advertising_agency", "newspaper", "logistics",
  "estate_agent", "employment_agency", "energy_supplier", "publisher", "property_management", "accountant", "architect", "engineer",
  "research", "tax_advisor", "travel_agent", "lawyer", "coworking", "financial_advisor", "bank",
])
const NOT_EMPLOYER = new Set([
  "government", "administrative", "ngo", "association", "religion", "political_party", "diplomatic", "educational_institution",
  "notary", "union", "charity", "foundation", "quango", "police", "military", "village_chief", "harbour_master",
])
