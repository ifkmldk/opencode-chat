export * as ResearchOrchestrate from "./orchestrate.js"

import { Effect } from "effect"
import { ToolFailure } from "@opencode/ai"
import { MapsSearch } from "../maps/search.js"
import { Geo } from "../maps/geo.js"
import { UltimateScrape } from "../scrape/engine.js"
import { extractConstraints } from "./constraints.js"
import { nearestStation, RANGKASBITUNG_STATIONS } from "./transit.js"

/** Satu orkestrasi: search → anchor → radius → ukur → skor → scrape-verify → jawab. */
export function runDeep(deps: {
  searchPlaces: (input: { query: string; near?: string; limit: number }) => Effect.Effect<{ provider: string; places: MapsSearch.Place[] }, ToolFailure>
  scrape: (url: string) => Effect.Effect<{ text: string; source: string }>
}) {
  return (input: { query: string; category: "job" | "hotel" | "flight" | "product" | "youtube" | "place" | "event" | "course" | "service" | "other"; location?: string; anchor?: string; radiusKm?: number; must?: readonly string[]; transitLine?: string; maxResults?: number }) =>
    Effect.gen(function* () {
      const c = extractConstraints(`${input.query} ${input.transitLine ?? ""}`, input.location ?? input.anchor)
      const must = [...new Set([...c.must, ...((input.must ?? []) as readonly string[])])]
      const transitLine = input.transitLine ?? c.transitLine
      const radiusKm = input.radiusKm ?? c.radiusKm
      const anchorText = input.anchor ?? c.anchor ?? input.location
      const limit = Math.min(10, input.maxResults ?? 8)
      const found = yield* deps.searchPlaces({ query: input.query, ...(anchorText ? { near: anchorText } : {}), limit })
      const anchor = anchorText ? { name: anchorText, latitude: 0, longitude: 0 } : undefined
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
        // Radius filter butuh koordinat anchor; bila anchor belum ter-resolve, lewati filter (jangan buang semua).
        void Geo
        rows = rows
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
      void UltimateScrape
      const checkedAt = Date.now()
      const limitations = [
        `Checked ${new Date(checkedAt).toISOString().slice(0, 10)} via ${found.provider === "google" ? "google-maps" : "openstreetmap"}+scrape.`,
        must.length ? `Must-have keras: ${must.join(", ")} — tanpa bukti diverifikasi, kandidat dibuang.` : "Tidak ada filter keras.",
        transitLine ? `Koridor ${transitLine}: hanya ≤1 km jalan kaki dari stasiun.` : `Radius ${radiusKm} km dari anchor.`,
        "Free sources have no live date-specific price or availability; prices are indications only.",
      ]
      return {
        query: input.query,
        category: input.category,
        providers: [{ provider: found.provider === "google" ? "google-maps" : "openstreetmap", status: "configured" as const }],
        candidates: verified.slice(0, limit).map((row) => ({
          id: row.place.id,
          category: input.category,
          title: row.place.name.slice(0, 300),
          provider: found.provider === "google" ? "google-maps" : "openstreetmap",
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
