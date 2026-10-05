export * as ResearchOrchestrate from "./orchestrate.js"

import { Effect } from "effect"
import { ToolFailure } from "@opencode/ai"
import { MapsSearch } from "../maps/search.js"
import { Geo } from "../maps/geo.js"
import { UltimateScrape } from "../scrape/engine.js"
import { extractConstraints } from "./constraints.js"
import { nearestStation, RANGKASBITUNG_STATIONS } from "./transit.js"

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

/** Lower-case words of a place text that identify it (cities, areas); short words and generic terms are ignored. */
export function locationTokens(text: string | undefined) {
  if (!text) return []
  const generic = new Set(["dekat", "sekitar", "area", "kota", "kabupaten", "daerah", "di", "yang", "dan", "jakarta"])
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !generic.has(word))
  const aliases: Record<string, string[]> = { tangsel: ["tangerang selatan", "serpong", "bsd", "alam sutra"], tangerang: ["tangsel", "serpong", "bsd", "alam sutra", "banten"], serpong: ["bsd", "tangsel", "tangerang"], bsd: ["serpong", "tangsel", "tangerang"] }
  return [...new Set(words.flatMap((word) => [word, ...(aliases[word] ?? [])]))]
}

/** Satu orkestrasi: search → anchor → radius → ukur → skor → scrape-verify → jawab. */
export function runDeep(deps: {
  searchPlaces: (input: { query: string; near?: string; limit: number }) => Effect.Effect<{ provider: string; places: MapsSearch.Place[] }, ToolFailure>
  searchJobs?: (input: { query: string; limit: number }) => Effect.Effect<{ results: { url: string; title?: string; content?: string }[]; error?: string }, ToolFailure>
  scrape: (url: string) => Effect.Effect<{ text: string; source: string }>
  /** Listings the user already applied to or rejected (saved as memory notes): they never come back in results. */
  excluded?: () => Effect.Effect<readonly string[]>
}) {
  return (input: { query: string; category: "job" | "hotel" | "flight" | "product" | "youtube" | "place" | "event" | "course" | "service" | "other"; location?: string; anchor?: string; radiusKm?: number; must?: readonly string[]; transitLine?: string; maxResults?: number }) =>
    Effect.gen(function* () {
      const c = extractConstraints(`${input.query} ${input.transitLine ?? ""}`, input.location ?? input.anchor)
      const must = [...new Set([...c.must, ...((input.must ?? []) as readonly string[])])]
      const transitLine = input.transitLine ?? c.transitLine
      const radiusKm = input.radiusKm ?? c.radiusKm
      const anchorText = input.anchor ?? c.anchor ?? input.location
      const limit = Math.min(10, input.maxResults ?? 8)
      // fork: resolve anchor ke koordinat via geocode — dipakai branch job (radius
      // non-koridor) dan branch place di bawah. Dideklarasikan sekali di sini agar
      // tidak ada deklarasi ganda dan tidak boros geocode.
      let anchorPoint: { name: string; latitude: number; longitude: number } | undefined
      if (anchorText && !transitLine) {
        const resolved = yield* deps
          .searchPlaces({ query: anchorText, ...(input.location ? { near: input.location } : {}), limit: 1 })
          .pipe(Effect.orElseSucceed(() => undefined))
        const first = resolved?.places?.[0]
        if (first?.latitude !== undefined && first?.longitude !== undefined) {
          anchorPoint = { name: first.name, latitude: first.latitude, longitude: first.longitude }
        }
      }
      // fork: job/category non-place tidak dicari di peta (OSM tidak berisi lowongan) —
      // pakai web fallback ber-lokasi, lalu tetap lewat filter koridor/radius + scrape-verify.
      // fork: KRL corridor research keeps its station-distance logic (owner's Serpong/Rangkasbitung use case).
      if (input.category === "job" && deps.searchJobs && input.transitLine) {
        const web = yield* deps.searchJobs({ query: input.query, limit }).pipe(Effect.orElseSucceed(() => ({ results: [] as { url: string; title?: string; content?: string }[] })))
        const checkedAt = Date.now()
        const maxM = Math.round((transitLine ? (c.transitWalkKm ?? 1) : radiusKm) * 1000)
        type JobRow = { id: string; title: string; url: string; summary: string; station?: string; distanceM?: number }
        const rows: JobRow[] = []
        for (const [i, r] of web.results.entries()) {
          const id = r.url || `job-${i}`
          const title = (r.title ?? r.url).slice(0, 300)
          const summary = (r.content ?? "").slice(0, 500)
          const text = `${title} ${r.content ?? ""} ${anchorText ?? ""}`.toLowerCase()
          let station: (typeof RANGKASBITUNG_STATIONS)[number] | undefined
          let distanceM: number | undefined
          if (transitLine) {
            for (const s of RANGKASBITUNG_STATIONS) {
              const short = s.name.replace(/^stasiun\s+/i, "").toLowerCase()
              if (short && text.includes(short)) {
                station = s
                distanceM = 0
                break
              }
            }
          }
          if (!station) {
            const probe = [title.split(/[-|,–]/)[0]!.trim(), anchorText ?? ""].filter(Boolean).join(" ").slice(0, 100)
            if (probe) {
              const geo = yield* deps
                .searchPlaces({ query: probe, ...(anchorText ? { near: anchorText } : {}), limit: 1 })
                .pipe(Effect.orElseSucceed(() => undefined))
              const first = geo?.places?.[0]
              if (first?.latitude !== undefined && first?.longitude !== undefined) {
                if (transitLine) {
                  const near = nearestStation({ latitude: first.latitude, longitude: first.longitude })
                  if (near.meters <= maxM) {
                    station = near.station
                    distanceM = Math.round(near.meters)
                  }
                } else if (anchorPoint) {
                  const m = Geo.inverse(anchorPoint, { latitude: first.latitude, longitude: first.longitude }).meters
                  if (m <= maxM) distanceM = Math.round(m)
                }
                if (transitLine && !station) continue
                if (!transitLine && anchorPoint && distanceM === undefined) continue
              } else if (transitLine || anchorPoint) {
                continue
              }
            } else if (transitLine || anchorPoint) {
              continue
            }
          }
          rows.push({ id, title, url: r.url, summary, ...(station ? { station: station.name } : {}), ...(distanceM !== undefined ? { distanceM } : {}) })
        }
        const kept: (JobRow & { verified: Record<string, "yes" | "no" | "unknown"> })[] = []
        for (const row of rows) {
          let keep = true
          const verified: Record<string, "yes" | "no" | "unknown"> = {}
          for (const key of must) {
            const scraped = row.url ? yield* deps.scrape(row.url).pipe(Effect.orElseSucceed(() => ({ text: "", source: "none" }))) : { text: "", source: "none" }
            const ok = !!scraped.text && new RegExp(key.replace(/_/g, "[\\s_-]*"), "i").test(scraped.text)
            verified[key] = ok ? "yes" : "no"
            if (!ok) {
              keep = false
              break
            }
          }
          if (keep) kept.push({ ...row, verified })
        }
        kept.sort((a, b) => (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER))
        const candidates = kept.slice(0, limit).map((row) => ({
          id: row.id,
          category: input.category as "job",
          title: row.title,
          provider: "web-search",
          ...(anchorText ? { location: anchorText } : {}),
          url: row.url,
          summary: [row.summary, row.station ? `dekat ${row.station}` : undefined, row.distanceM !== undefined ? `${(row.distanceM / 1000).toFixed(1)} km` : undefined].filter(Boolean).join(" · "),
          ...(row.distanceM !== undefined ? { distanceM: row.distanceM } : {}),
          ...(row.station ? { station: row.station } : {}),
          verified: row.verified,
          checkedAt,
          source: "web-search" as const,
        }))
        return {
          query: input.query,
          category: input.category,
          providers: [{ provider: "web-search", status: "configured" as const }],
          candidates,
          limitations: [
            `Checked ${new Date(checkedAt).toISOString().slice(0, 10)} via web-search.`,
            transitLine ? `Koridor ${transitLine}: hanya ≤${(maxM).toFixed(0)} m jalan kaki dari stasiun.` : anchorPoint ? `Radius ${radiusKm} km dari anchor.` : "Filter lokasi via teks lowongan.",
            "No structured jobs provider is configured; results are web-research candidates, not live applications. Verify on the employer's page.",
          ],
          checkedAt,
        }
      }
      if (input.category === "job" && deps.searchJobs) {
        // fork: the job branch used hotel logic (carport/furnished regexes, station tables, drop on geocode failure) and
        // swallowed search errors, so real listings were thrown away and an outage looked like "no jobs". Now: search once
        // more widely, keep every listing, verify location by reading the page, put verified ones first, and say plainly
        // when the search failed or found nothing.
        const searched = yield* deps.searchJobs({ query: input.query, limit: Math.max(limit * 2, 10) }).pipe(Effect.result)
        const checkedAt = Date.now()
        const results = searched._tag === "Success" ? searched.success.results : []
        const failure =
          searched._tag === "Failure"
            ? ((searched.failure as Error)?.message ?? String(searched.failure))
            : searched.success.error
        const tokens = locationTokens(anchorText ?? input.location)
        type JobRow = { id: string; title: string; url: string; summary: string; location: "yes" | "no" | "unknown" }
        const rows: JobRow[] = results.map((r, i) => {
          const text = `${r.title ?? ""} ${r.content ?? ""} ${r.url}`.toLowerCase()
          return {
            id: r.url || `job-${i}`,
            title: (r.title ?? r.url).slice(0, 300),
            url: r.url,
            summary: (r.content ?? "").slice(0, 500),
            location: tokens.length > 0 && tokens.some((token) => text.includes(token)) ? "yes" : "unknown",
          }
        })
        // Read the first listings: the page itself (structured JobPosting data first) settles the location.
        for (const row of rows.slice(0, 6)) {
          if (!row.url || tokens.length === 0) continue
          const page = yield* deps.scrape(row.url).pipe(Effect.orElseSucceed(() => ({ text: "", source: "none" })))
          const lower = page.text.toLowerCase()
          if (tokens.some((token) => lower.includes(token))) row.location = "yes"
          else if (lower.includes("structured job postings") && page.text.length > 400) row.location = "no"
        }
        const seenNotes = deps.excluded ? yield* deps.excluded() : []
        const kept = rows.filter((row) => row.location !== "no" && !isExcluded(row, seenNotes))
        kept.sort((a, b) => Number(b.location === "yes") - Number(a.location === "yes"))
        const candidates = kept.slice(0, limit).map((row) => ({
          id: row.id,
          category: input.category as "job",
          title: row.title,
          provider: "web-search",
          ...(anchorText ? { location: anchorText } : {}),
          url: row.url,
          summary: row.summary,
          verified: { location: row.location },
          checkedAt,
          source: "web-search" as const,
        }))
        const empty = candidates.length === 0
        return {
          query: input.query,
          category: input.category,
          providers: [
            {
              provider: "web-search",
              status: failure ? ("error" as const) : empty ? ("unavailable" as const) : ("configured" as const),
              ...(failure ? { message: failure.slice(0, 300) } : empty ? { message: "The search returned no listings." } : {}),
            },
          ],
          candidates,
          limitations: [
            `Checked ${new Date(checkedAt).toISOString().slice(0, 10)} via web-search.`,
            ...(failure ? [`The job search failed (${failure.slice(0, 200)}). Report this to the user; do not list jobs from memory.`] : []),
            ...(empty && !failure ? ["No listings were found. Say so and suggest a broader query; do not invent any."] : []),
            tokens.length > 0
              ? `Location filter: "${anchorText ?? input.location}". Rows marked location=unknown were not confirmed on the listing page; listings whose page shows another location were dropped.`
              : "No location was given, so listings are not location-filtered.",
            "No structured jobs provider is configured; results are web-research candidates, not live applications. Verify on the employer's page and use the link to apply.",
          ],
          checkedAt,
        }
      }
      // (anchorPoint sudah di-resolve di atas, sebelum branch job — pakai langsung,
      // tanpa resolve ulang agar tidak boros geocode dan tidak ada deklarasi ganda).
      const found = yield* deps.searchPlaces({ query: input.query, ...(anchorText ? { near: anchorText } : {}), limit })
      const anchor = anchorPoint
      type Row = { place: MapsSearch.Place; distanceM?: number; station?: string; verified: Record<string, "yes" | "no" | "unknown"> }
      let rows: Row[] = found.places.map((place) => ({ place, verified: Object.fromEntries(must.map((k) => [k, "unknown" as const])) }))
      // Corridor KRL: hanya yang ≤1 km jalan kaki dari salah satu stasiun line.
      if (transitLine === "KRL Rangkasbitung") {
        rows = rows.flatMap((row) => {
          if (row.place.latitude === undefined || row.place.longitude === undefined) return []
          const near = nearestStation({ latitude: row.place.latitude, longitude: row.place.longitude }, RANGKASBITUNG_STATIONS)
          if (near.meters > 1000) return []
          return [{ ...row, distanceM: Math.round(near.meters), station: near.station.name }]
        })
      } else if (anchorText) {
        // fork: radius filter — buang yang > radiusKm dari anchor, sisanya bawa distanceM + sort.
        // Tanpa anchorPoint (geocode gagal), jangan buang semua.
        if (anchorPoint) {
          const maxM = radiusKm * 1000
          rows = rows.flatMap((row) => {
            if (row.place.latitude === undefined || row.place.longitude === undefined) return []
            const m = Geo.inverse(anchorPoint, { latitude: row.place.latitude, longitude: row.place.longitude }).meters
            if (m > maxM) return []
            return [{ ...row, distanceM: Math.round(m) }]
          })
        }
      }
      // Scrape-verify atribut must[] (filter keras): tanpa bukti → buang.
      const verified: Row[] = []
      for (const row of rows) {
        let keep = true
        const next: Record<string, "yes" | "no" | "unknown"> = { ...row.verified }
        for (const key of must) {
          const urls = [row.place.url, row.place.website].filter((u): u is string => !!u)
          let foundAttr = false
          for (const url of urls.slice(0, 2)) {
            const scraped = yield* deps.scrape(url).pipe(Effect.orElseSucceed(() => ({ text: "", source: "none" })))
            if (scraped.text && new RegExp(key.replace(/_/g, "[\\s_-]*"), "i").test(scraped.text)) {
              foundAttr = true
              break
            }
          }
          next[key] = foundAttr ? "yes" : "no"
          if (!foundAttr) {
            keep = false
            break
          }
        }
        if (keep) verified.push({ ...row, verified: next })
      }
      // fork: sort koridor/radius by distanceM agar yang terdekat duluan.
      verified.sort((a, b) => (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER))
      const checkedAt = Date.now()
      const providerName = found.provider === "google" ? "google-maps" : found.provider === "scraped" ? "scraped" : "openstreetmap"
      const limitations = [
        `Checked ${new Date(checkedAt).toISOString().slice(0, 10)} via ${providerName}+scrape.`,
        must.length ? `Must-have keras: ${must.join(", ")} — tanpa bukti diverifikasi, kandidat dibuang.` : "Tidak ada filter keras.",
        transitLine ? `Koridor ${transitLine}: hanya ≤1 km jalan kaki dari stasiun.` : `Radius ${radiusKm} km dari anchor${anchorPoint ? ` (${anchorPoint.latitude.toFixed(4)}, ${anchorPoint.longitude.toFixed(4)})` : ""}.`,
        "Free sources have no live date-specific price or availability; prices are indications only.",
      ]
      return {
        query: input.query,
        category: input.category,
        providers: [{ provider: providerName, status: "configured" as const }],
        candidates: verified.slice(0, limit).map((row) => ({
          id: row.place.id,
          category: input.category,
          title: row.place.name.slice(0, 300),
          provider: providerName,
          location: row.place.address,
          url: row.place.googleMapsUrl ?? row.place.url,
          summary: [row.place.address, row.station ? `dekat ${row.station}` : undefined, row.distanceM !== undefined ? `${(row.distanceM / 1000).toFixed(1)} km` : undefined].filter(Boolean).join(" · "),
          distanceM: row.distanceM,
          ...(anchorText ? { anchor: anchorText } : {}),
          verified: row.verified,
          checkedAt,
          source: "openstreetmap" as const,
          ...(row.station ? { station: row.station } : {}),
        })),
        ...(anchor ? { anchor } : {}),
        limitations,
        checkedAt,
      }
    })
}
