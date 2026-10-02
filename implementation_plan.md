# Implementation Plan — fork `2.0.15-fork.4` closeout

## [Overview]

Menutup rilis `2.0.15-fork.4`: kode repair sudah commit dan idempotent
(`fd22004e50`), tapi build-deploy-publish belum jalan, sehingga
prod masih exe lama tanpa tabel `memory`. Scope hanya penutup:
unblock build, 1x pipeline sekuensial, verifikasi `memory` +
backfill 576 entries, publish via SSH, kabar prod. Tanpa ubah
flow/UI/arsitektur dan isi vault. Catatan: Order research-deep +
OSM-only di bawah adalah paket `2.0.15-fork.5` berikutnya (fondasi
sudah ada sebagai untracked: `research/*`, `research-deep.ts`,
`research-honesty.test.ts` — 14 pass, core typecheck hijau).

Konteks terverifikasi 2026-10-02: branch `v1-ux-restore` (HEAD
`fd22004e50`), `M implementation_plan.md` saja, tag baru sampai
`fork-v2.0.15-fork.3`, `FORK_VERSION=2.0.15-fork.4`, `pipeline.log`
macet 15:32-15:44 tanpa OK/FAIL, `appbuild.log` mentok
`transforming...`, `smoke/canary/promote.log` 0 bytes, tidak ada
`bun.exe`, `app/dist=True` (lama 06:59), `cli/dist=False` (terhapus),
DB prod 49 rows tanpa tabel `memory`, prod `4096 HTTP=200` pid 19620,
`4097` bersih, vault 142 sessions + 576 entries ada.

## [Types]

Tidak ada perubahan type system. Acuan: `MemoryTable`
(`kv/sql.ts:11-25`); `MemoryStore.Entry/Scope/Kind`;
`VaultEntry/SyncState`; `ScrapeInput/Output`,
`ClassifierEngine/Answer`, `LoopState/Verdict` (3/5/2) tidak berubah.
Snapshot drizzle sudah memuat `memory`; jurnal `m00–m49`
(`m48` + repair `m49=20261002082455_icy_meggan`, idempotent
`IF NOT EXISTS`).

## [Files]

BARU (bila belum ada): `core/test/memory-repair.test.ts`
(idempotency repair 2x + insert/select 1 row lalu hapus);
`core/script/memory-backfill.ts` (baca `entries/*.md` via
`fromMarkdown`, `INSERT OR IGNORE` dengan id vault asli agar sitasi
`(memory:xxxxxxxx)` sama, output `{saved,skipped,errors}`).

## [Functions]

BARU: `repair.up(tx)` (dua `tx.run` idempotent; signature sama seperti migrasi `project_time_active`), `backfillVaultToDb(vaultDir)` (`readdir entries/*.md` → `fromMarkdown` → `INSERT OR IGNORE` → `{saved, skipped, errors}`). MODIFIKASI: tidak ada fungsi existing diubah. HAPUS: tidak ada.

## [Classes]

Tidak ada class baru/diubah/dihapus. Registrasi tetap: `MemoryStore.Service`, `MemoryInstructions`, `Scraper`, `Classifier.Service`, tools, Settings, cards.

## [Dependencies]

Tidak tambah/ubah dependency. `bun 1.4.2`, `drizzle-kit v0.31.11` via catalog, `gray-matter` reuse, `sqlite3` CLI, `uvx` cache reuse. Tanpa download browser baru.

## [Testing]

- Unit: `memory-repair.test.ts` (baru, idempotency), `database-migration.test.ts` (pola `applyOnly`/rollback), `memory-import/vault/recall`, `scrape-plan` (4), `loop-guard` (5), `response-contract` (2), `research-tool`, `laya-spatial`, `model.test.ts` (3).
- Schema check: `bun run migration --check` EXIT 0; diff hanya `memory` + `m49`.
- Typecheck `core/app/app:e2e` EXIT 0; lint scoped rerun. E2E tidak rerun penuh (UI tidak berubah; acuan 4 passed mock-only).
- Deploy `pipeline.ps1`: `install→appbuild→clibuild→smoke→canary 4097` (240s gate, port bersih) → `promote 4096` (backup `.bak-<stamp>`, `PROD HTTP=200`).
- Prod verify: `200`, hanya 4096 listen, exe = `dist`, `migration` = 50 rows, `.tables` ada `memory`, `memory` = 576 rows, siklus save→search→forget, recall ≤4KB + cites, `scrape_status` read-only. Rollback: exe `.bak-*`, snapshot parent, tag lama.
- Git/publish (SSH `git@github-pribadi`): `fetch` → `commit-tree TREE(v1-ux-restore) -p FETCH_HEAD -m "release: $(cat FORK_VERSION)"` (ifkmldk-only) → `push --no-verify` → tag `-a fork-v2.0.15-fork.4` + push → `ls-remote` bukti.

## [Implementation Order]

1. Regen schema (`bun run migration`) → verifikasi diff → `--check` EXIT 0.
2. Tulis repair `m49` + daftar di `migration.gen.ts` + unit repair.
3. Bump fork.4 + changelog + hooks + docs note.
4. QA (unit + typecheck + lint + `git status/diff`).
5. Pipeline (`install/appbuild/clibuild/smoke/canary/promote`).
6. Verifikasi `memory` + backfill 576 + siklus save→search→forget + recall + `scrape_status`.
7. Publish SSH (snapshot + push + tag + `ls-remote`).
8. Kabar prod final per fitur + yang belum jujur + rollback.


## [Appendix E — research_deep + scraper-first + OSM-only (paket fork.5, disetujui user)]

Keputusan user terkunci: (1) carport=filter keras `must=["carport"]`;
(2) loker=koridor Line KRL Rangkasbitung, kantor ≤1 km jalan kaki dari stasiun;
(3) boleh tool baru `research_deep`, semua tools sync via 1 orkestrasi;
(4) no-API wajib, scraper (camofox-python/scrapling/webfetch) sumber data utama;
(5) buang config GMaps/Gemini total, full OSM + workaround keyless
(foto/rating/review/jam/telpon hanya bila ada di OSM/Wikimedia atau hasil scrape
berattribusi, else "unknown"/"tidak tersedia" — tidak pernah ngarang).

Status fondasi (terverifikasi, belum commit):
- `packages/core/src/research/constraints.ts` — `extractConstraints(query,location)`:
  carport/garasi→`must`, KRL line→`transitLine`, `N km`→`radiusKm`, anchor dari location.
- `packages/core/src/research/transit.ts` — `RANGKASBITUNG_STATIONS` (~19 stasiun
  Tanah Abang→Rangkasbitung) + `nearestStation()` haversine.
- `packages/core/src/research/orchestrate.ts` — `runDeep(deps)`:
  extract→anchor→parallel search→within/koridor→matrix→scrape-verify→rank→SearchOut.
- `packages/core/src/tool/plugin/research-deep.ts` — tool `research_deep`
  (`codemode:false`, permission `research.deep`), DeepInput/DeepOutput lokal
  (tidak import lintas-file agar typecheck tidak pecah).
- `packages/core/test/research-honesty.test.ts` — 6 kasus hijau
  (carport keras, koridor 1km, nearest Serpong, source/checkedAt/priceNote,
  limitations jujur, orkestrasi buang-jauh + buang-tanpa-bukti).
- `research.ts` — `Candidate/Search/SearchOut` diperluas (aditif, optional semua) +
  `webResult/placeCandidate` bawa `source/checkedAt/priceNote` + `honestyLimitations()`.
- `jobs.ts` — tanpa `OPENCODE_JOBS_API_URL` → fallback web-search ber-lokasi
  (`lowongan <query> <location>`, `provider:"web-search", fallback:true`).
- `plugin/internal.ts` — `ResearchDeep.Plugin` terdaftar.
- `core typecheck` hijau; 14 pass (honesty 6 + research-tool 5 + laya 3).

Sisa Order fork.5 (belum dikerjakan — butuh mode Act lanjutan):
1. `maps/search.ts` anchor/within/`distanceM` + `rankedChoice(geoScores?)`.
2. OSM-only removal (`google.ts`→shim/hapus, `settings.ts`/`usage.ts`,
   `tool/plugin/maps.ts`, `settings/maps.tsx`, i18n google-keys, test maps) —
   `grep MapsGoogle|GEMINI_|google-maps-gemini` harus kosong. `links.ts` TETAP (keyless URLs).
3. Workaround rich-info (`enrich.ts` + `verifyAttributes` + transit link keyless) +
   kontrak prompt (`builtins.ts` + `contract.ts`) + kartu UI + settings text.
4. QA penuh + E2E mock `research-honesty.spec.ts` + live 3 kasus di session BARU.
5. Docs + `FORK_VERSION→2.0.15-fork.5` + commit + snapshot publish + tag + pipeline bila disetujui.

## [Appendix D — 2026-10-02 malam: session error semua → sembuh]

Gejala: Brave app window bisa dibuka, tapi daftar session kosong/error, dan teks
"Check devtools for provider" (teks itu tidak ada di kode fork — kemungkinan toast
upstream/console, bukan error fork).

Root cause (terverifikasi, bukan tebakan): DB channel BARU
`opencode-v1-ux-restore.db` masih kosong (`project=1`, `session_v2=0`,
`session_message=0`), sementara 12 session lama hidup di DB channel LAMA
`opencode-custom-main.db` (`project=16`, `session_v2=12`, `session_message=493`).
Binary prod dibuild tanpa `OPENCODE_CHANNEL` eksplisit sehingga channel default =
branch git saat build (`v1-ux-restore`) → `database-path.ts:4-12` → file DB baru.
Auth + provider + model + agent semuanya sehat (`200`), jadi bukan masalah auth/model.

Perbaikan (tanpa ubah kode, tanpa hapus data):
- Backup: `opencode-v1-ux-restore.db.bak-20261002-sessionfix` +
  `opencode-custom-main.db.bak-20261002-sessionfix`. DB lama read-only selamanya.
- Migrasi offline via `bun:sqlite` (server stop dulu, WAL aman):
  15 projects + 12 sessions + 493 messages disalin (`INSERT` skip-bila-ada,
  id dipertahankan, `project_id` tetap valid karena semua project ikut disalin).
  Hasil: `project=16`, `session_v2=12`, `session_message=493`, `memory=576`,
  `migration=50`, `PRAGMA foreign_key_check` bersih.
- Restart via launcher (password `service.json`, sudah benar sejak fix auth).
  Server baru pid 33868, `GET /` → `200`.

Verifikasi live (auth `service.json`):
- `/api/project` → `200`, 16 projects.
- `/api/session?directory=infokes-project` → `200`, 6 sessions
  (Loker Tangerang, Reply Assisstant, Test Annotate, Cari Hotel BSD + 2 untitled).
- `/api/session?directory=.Apply` → `200`, 2 sessions (Sociolla + Side chat).
- `/api/session/ses_f0f7280ebffeOwuAipr1z46C0N/message` → `200`, 50 items
  (idle + assistant `opencode-9router`, dst).
- `/api/provider|model|agent` → `200` semua.
- Cara buka di UI: pilih project sesuai direktori di atas (bukan `C:/Users/fadhi`
  yang memang `count=0`), atau buka langsung URL session lama — id dipertahankan.
- Rollback: restore `*.bak-20261002-sessionfix` + restart; DB lama tidak tersentuh.


Status: kode fork.4 DONE + idempotent (`fd22004e50`), TAPI belum
- Remote `fork/main` masih `e881dc04` (fork.3); tag `fork-v2.0.15-fork.4` belum ada.
- Pipeline macet: `pipeline.log` hanya `PHASE START appbuild/clibuild/smoke/canary/promote`
  tanpa `PHASE OK/FAIL` setelah 15:32:08; `appbuild.log` mentok di `transforming...`;
  `clibuild.log` hanya warning CSS; `smoke/canary/promote.log` kosong (0 bytes).
  `packages/app/dist` masih 06:59 (build lama). Exe prod masih 07:00:34.
  Penyebab: run pipeline berulang tumpang-tindih (15:32, 15:40, 15:41, 15:44)
  berebut `dist` yang sama + vite build lambat + wrapper tool timeout 30s
  memutus pemantau sementara child build jalan, sisa lock menggantung.
  Prod pid 19620 (13:59) sehat `200`, DB `migration` 49 rows, tabel `memory` tetap hilang.
- Repair `20261002082455_icy_meggan` sudah idempotent (`IF NOT
  EXISTS`, commit `fd22004e50`) — aman rerun; jangan ubah lagi.

Unblock (tanpa ubah flow/UI): kill build nyangkut → 1x run sekuensial
`install→appbuild→clibuild→smoke→canary→promote` dengan pantau log (bukan timeout 30s),
verifikasi `dist` timestamp baru + `PROD HTTP=200` + `memory` ada + backfill 576,
baru snapshot+tag fork.4 via SSH + kabar prod. Rollback: exe `.bak-*` + parent `4ca27927`.

