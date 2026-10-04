# Implementation Plan — research_deep + scraper-first + OSM-only (fork.6, DONE sesuai Order 1–4)

## [Overview]

SELESAI (Order 1–4 fork.6): jawaban research/maps presisi — carport filter keras, loker koridor
KRL Rangkasbitung 1 km walking, `research_deep` 1 orkestrasi, scraper-first tanpa API key, full OSM.
Sisa Order 5 (live 3 kasus + pipeline + prod) dikerjakan setelah commit/push ini.

Keputusan terkunci dari user: (1) carport=filter keras; (2) loker=koridor Line Rangkasbitung 1 km walking;
(3) tambah `research_deep`, semua tools sync 1 orkestrasi; (4) no-API, scrape semua sumber;
(5) buang GMaps/Gemini, full OSM + workaround keyless.

## [Types] — terimplementasi, tidak berubah lagi

```ts
Constraints { anchor?: string; radiusKm: number; must: string[]; transitLine?: string; transitWalkKm?: number; travelMode: TravelMode }
Candidate += { distanceM?; anchor?; travelMode?; travelMinutes?; verified?: Record<string,"yes"|"no"|"unknown">; checkedAt?; source?: "openstreetmap"|"web-search"|"scraped"; priceNote?; priceSource?; ratingSource?; station? }
Search += { anchor?; radiusKm? (0.1–100); travelMode?; must?; transitLine? }
SearchOut += { anchor?; stations?; limitations; checkedAt }
Place += { distanceM?; rating?; ratingCount?; ratingSource?; priceLevel?; priceSource?; source: "openstreetmap"|"scraped" }
PlaceQuery += { anchor?: Geo.Point|string; radiusKm? }
```

## [Files] — DONE Order 1–4

- Order 1: `constraints.ts` (anchor-from-query, must/transitLine/radius), fix buang-lokasi `research.ts:42`,
  `jobs.ts` fallback ber-lokasi, `research-honesty.test.ts` (6 pass + 1 orchestrate).
- Order 2: `transit.ts` (19 stasiun + `nearestStation`), `search.ts` anchor/within/`distanceM`,
  `orchestrate.ts` anchor-resolve + koridor + scrape-verify + sort.
- Order 3: `research-deep.ts` (`research_deep`, `research.deep`), terdaftar `internal.ts:91,262`,
  `verifyAttributes` via `UltimateScrape.run` (chain stealth).
- Order 4: OSM-only removal — `google.ts` shim-throw, `settings.ts`/`usage.ts` no-op OSM,
  `protocol/groups/maps.ts` + `server/handlers/maps.ts` OSM-only, `maps.tsx` tanpa key/limit/test,
  `en.ts` hapus `settings.maps.google*` (+`osmOnlyNotice`), test maps shim/no-op.
- Rich-info: `enrich.ts` (`ogImage`, `contactFrom`, `ratingFromScrape`).
- Kontrak: `core/geo` + `contract.ts` (pipeline wajib, tabel, badge, `map_show`).
- Kartu UI: `tool-renderer.tsx` (jarak/stasiun/badge verified) + `maps-output.tsx` (rating berattribusi).
- Settings: `research-providers.tsx` + `research-provider-fields.ts` helper jujur.
- Live geocode verified: Jl. Sudirman Bandung (-6.9204,107.6002), BSD (-6.3004,106.6659),
  Stasiun Rangkasbitung (-6.3526,106.2511).

## [Functions] — DONE

`extractConstraints`, `nearestStation`, `runDeep`, `verifyAttributes`, `honestyLimitations`,
`ogImage/contactFrom/ratingFromScrape`, `rankedChoice(geoScores?)`.

## [Classes] — tidak ada perubahan.

## [Dependencies] — nol baru.

## [Testing] — DONE (unit+typecheck); SISA: E2E mock + live 3 kasus + pipeline + prod

- 17 pass / 2 skip (live probes, butuh `OPENCODE_LIVE_PROBE=1` + network, tanpa kuota).
- Typecheck hijau: core, app, app:e2e, ui, session-ui, protocol, server, client.
- SISA Order 5: `research-honesty.spec.ts` E2E mock + live session BARU 3 kasus + pipeline + restart 4096 + verifikasi prod.

## [Implementation Order] — status

1. ✅ constraints + fix lokasi + jobs. 2. ✅ transit + search anchor. 3. ✅ orchestrate + research_deep.
4. ✅ OSM-only + rich-info + kontrak + kartu UI. 5. ⏳ E2E + live + pipeline + prod + docs final + push fork.6.


## [Types]

```ts
// packages/core/src/research/constraints.ts (BARU)
export type TravelMode = "driving"|"walking"|"transit";
export interface Constraints { anchor?: string; radiusKm: number; must: string[]; transitLine?: string; transitWalkKm?: number; travelMode: TravelMode; }
// packages/core/src/research/transit.ts (BARU)
export type Station = { name: string; latitude: number; longitude: number };
// research.ts (perluasan aditif, semua optional):
Candidate += { distanceM?: number; anchor?: string; travelMode?: TravelMode; travelMinutes?: number; verified?: Record<string,"yes"|"no"|"unknown">; checkedAt?: number; source?: "openstreetmap"|"web-search"|"scraped"; priceNote?: string; station?: string; }
Search += { anchor?: string; radiusKm?: number; travelMode?: TravelMode; must?: string[]; transitLine?: string; }
SearchOut += { anchor?: {name:string;latitude:number;longitude:number}; stations?: Station[]; limitations: string[]; checkedAt: number; }
// maps/search.ts: Place += { distanceM?: number }; PlaceQuery += { anchor?: Geo.Point|string; radiusKm?: number };
```

## [Files]

BARU (fork-owned): `packages/core/src/research/constraints.ts` (extractConstraints: carport/garasi→must, KRL-pattern→transitLine, `(\d)km`→radiusKm); `packages/core/src/research/transit.ts` (RANGKASBITUNG_STATIONS ~19 stasiun + nearestStation via haversine, cache KV `transit:stations:v1`); `packages/core/src/research/orchestrate.ts` (runDeep 9 langkah); `packages/core/src/tool/plugin/research-deep.ts` (tool research_deep, codemode:false, permission research.deep); `packages/core/test/research-honesty.test.ts` + `research-orchestrate.test.ts`; `packages/app/e2e/user-story/research-honesty.spec.ts`.

MODIFIKASI: `research.ts:11-16,24-43` (schema+webResult/placeCandidate/mapsQuery pakai lokasi+honestyLimitations); `maps/search.ts:72-164` (anchor resolve+within+distanceM); `maps/osm.ts:33-79` (near dari anchor); `jobs.ts:8,22-28` (fallback web ber-lokasi, no ToolFailure buta); `maps.ts` plugin (anchor/radius_m, hapus GEMINI_*); `classifier/engine.ts:41-119` (rankedChoice terima geoScores opsional); `builtins.ts:95-108` (pipeline 6 langkah wajib+tabel+map_show); `contract.ts` (tabel+unknown); `tool-renderer.tsx` + `maps-output.tsx` (kolom Jarak/Waktu/Stasiun+badge verified); `research-providers.tsx` (helper jujur). OSM-ONLY: hapus `maps/google.ts` (jadi shim throw), `settings.ts`+`usage.ts` (sisa osm), `protocol/groups/maps.ts`+`server/handlers/maps.ts` (status osm-only), `maps.tsx` (hapus section key), `en.ts` keys google*, test maps. `links.ts` TETAP (keyless URLs).

HAPUS: `maps/google.ts` (shim), config Gemini. Session/DB/vault tidak disentuh.

## [Functions]

BARU: `extractConstraints()`, `nearestStation()`, `runDeep()`, `verifyAttributes(urls,must[])` via UltimateScrape.run, `honestyLimitations()`, `formatCheckedAt()`. MODIFIKASI: `webResult()`, `placeCandidate()`, `mapsQuery()`, `research_search` executor, `MapsSearch.places()`, Jobs executor, `rankedChoice()`. HAPUS: `MapsGoogle.places/ask/test/generate`, `MapsUsage.*` quota, `MapsSettings` google-branch.

## [Classes]

Tidak ada class baru/diubah/dihapus (fungsi + Service existing: Memory/Service, Scraper, Classifier, SettingsScrape/Memory, ScrapeToolOutput/MemoryToolOutput tetap).

## [Dependencies]

Nol dependency baru. Reuse UltimateScrape (camofox-python default, scrapling/webfetch fallback), OSM (Nominatim/Photon/OSRM/Overpass/Wikimedia), links.ts keyless. Tanpa API berbayar. Catatan: situs besar bisa rate-limit → chain stealth + pesan jujur bila semua tier gagal.

## [Testing]

Unit `bun test`: lokasi dipakai, anchor+radius (jauh dibuang), must=[carport]→unknown/buang, koridor 1km walk, rank deterministik, grep tidak ada import google/gemini. Typecheck core/app/app:e2e/ui/session-ui/protocol/client EXIT 0; lint scoped 0. E2E mock-only (3107/4998): research-honesty.spec.ts baru + existing tetap pass. Live di session BARU: 3 kasus vs jawaban lama; wajib tabel+jarak+badge+map_show.

## [Implementation Order]

1. constraints.ts + fix buang-lokasi + jobs fallback. 2. transit.ts + search.ts anchor/within/distanceM. 3. orchestrate.ts + research-deep.ts + verifyAttributes. 4. OSM-only removal + rich-info workaround. 5. Kontrak prompt + kartu UI + settings. 6. Unit+typecheck+lint+E2E mock + live 3 kasus. 7. Docs + commit (bump bila skema berubah).
