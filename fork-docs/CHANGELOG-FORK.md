# Fork changelog

## 2.0.15-fork.10 (2026-10-05)

Fase 3 dari audit paritas agen (bagian yang aman dikerjakan tanpa LLM nyata).

- **Tool `todo_write`:** checklist multi-langkah yang terlihat (setara TodoWrite Claude Code / rencana Codex). Model
  mengirim seluruh daftar tiap pembaruan (pending / in_progress / completed); panggilannya sendiri adalah state, jadi
  tidak ada penyimpanan baru dan aman terhadap compaction. Kartu timeline "Checklist" menampilkan "2 of 5 done · item
  aktif" dan daftar lengkap bila dibuka; tampil juga di mode Chat dan Classifier. Instruksi `core/todo` memberi tahu
  kapan memakainya.
- **Pesan error yang membimbing:** kegagalan `scrape_fetch`, provider jobs dan provider research kini menyuruh model
  tidak mengarang data dan menyebut langkah berikutnya (mode lain, `websearch`, atau katakan terus terang).
- **Hasil audit Fase 3:** mode izin (agen `plan` + setelan "auto-approve"), panel pekerjaan latar belakang untuk
  subagen (`session/summary/background.tsx`) dan Undo (`command.session.undo`) ternyata sudah ada di upstream, jadi
  tidak dibangun ulang. Ditunda dengan alasan: gerbang tool `browser.*` per sesi (registri tool di-scope per
  Location, butuh desain inti), hook shell pengguna dan sandbox (permukaan keamanan, perlu keputusan pemilik).
## 2.0.15-fork.9 (2026-10-05)

Fase 2 dari audit paritas agen: mesin dokumen "ala Claude" (kode + skill + render lalu periksa).

- **Tool `office_render`:** mengubah docx/pptx/xlsx/pdf/html menjadi PDF dan PNG per halaman, lalu menampilkan gambarnya
  ke model (maks 8 per panggilan, argumen `pages`/`scale`). Mesin, berurutan: Microsoft Word/PowerPoint/Excel yang
  terpasang (COM, tanpa jendela, proses sisa dibersihkan), LibreOffice bila ada, Chromium untuk HTML. Windows tanpa
  printer memblokir ekspor PDF Excel; fallback-nya Excel→HTML per sheet→Chromium→gabung PDF.
- **Tool `office_kit`:** memasang sekali (npm) dan menemukan "office kit": pustaka tata letak untuk deck
  (`pptxgenjs`), laporan Word (`docx`), workbook (`exceljs`), plus `mupdf` (WASM) untuk merender PDF ke PNG. Folder
  default `~/.local/share/opencode/office-kit` (`OPENCODE_OFFICE_KIT`; `OPENCODE_OFFICE_NO_INSTALL=1` mematikan
  pemasangan otomatis). Kit: 6 palet, 5 pasangan font, 13 tipe slide, laporan dengan style heading/daftar asli.
- **Skill bawaan:** `office-design` (proses, pilihan tampilan, aturan anti-AI-slop, daftar periksa render),
  `pptx`, `docx`, `xlsx`, `pdf`. Instruksi `core/office` menyuruh model memuatnya, membangun dengan kit, lalu
  render dan melihat tiap halaman sebelum menyerahkan.
- **Preview dokumen akurat:** docx/pptx/xlsx di panel file dirender server menjadi PDF (endpoint
  `office.preview`, di-cache per hash) dan ditampilkan pdf.js, dengan toggle Exact/Quick; tampilan Quick lama
  (mammoth, pptx-preview, tabel) tetap sebagai cadangan saat mesin tidak ada.
- Catatan: pemindai artefak rilis menolak string pustaka canvas native, jadi rasterizer memakai `mupdf` (WASM).
  Preview pptx di panel file kosong pada harness QA (juga di build fork.8): belum diselidiki.

## 2.0.15-fork.8 (2026-10-05)

Fase 1 dari audit paritas agen: perbaikan cepat atas kegagalan nyata di sesi pemilik.

- **Angka berbentuk string diperbaiki untuk semua tool.** `maps_poi` menolak `radius_m:"1000"` karena cabang enum
  `"NaN"` dari `Schema.Number` dianggap menerima string apa pun. `repair()` di `core/src/plugin/tool-input-repair.ts`
  sekarang mengabaikan cabang enum/const yang tidak memuat nilainya (berlaku juga untuk tool MCP dan plugin).
- **Shell Windows:** deskripsi tool `shell` memuat aturan sintaks per shell (PowerShell 5.1 tanpa `&&`, jangan membungkus
  `powershell -Command`, jangan sintaks bash).
- **`webfetch` yang diblokir (403/429/5xx) atau halaman kosong berbasis JS** otomatis jatuh ke scraper stealth
  (izin `scrape.fetch`), dengan pesan error yang menunjuk `scrape_fetch`. Scraper: kegagalan Camofox sekarang
  gagal biasa, bukan defect yang menghentikan tier berikutnya.
- **Tool `browser.*` di UI web** gagal dengan pesan yang mengarahkan ke `webfetch`/`scrape_fetch`/`preview_file`.
- **Thinking disembunyikan di semua mode** (Chat, Code, Classifier) kecuali setting baru "Show thinking" dinyalakan.
  Kata "Thinking" diganti indikator titik-titik.
- **Composer:** Shift+Enter melanjutkan daftar bernomor/bullet, Tab / Shift+Tab mengatur indentasi, Backspace di
  belakang marker menurunkan level lalu menghapus marker. Enter tetap mengirim.
- **Preview HTML:** halaman disajikan dari server (rute `browser-proxy/preview` bertiket, header `sandbox`), jadi
  JavaScript inline dan CDN jalan (CSP aplikasi sebelumnya memblokirnya di frame blob). Teks di preview bisa dikutip
  atau diberi catatan, dengan nomor baris sumber (`source lines 12-14`) ikut ke model.

## 2.0.15-fork.7 (2026-10-04)

`research_deep` selesai + kartu jujur + job koridor geocode (jawaban Sudirman/carport/KRL presisi):

- Branch job `orchestrate.ts` tidak lagi return awal: station-name match cepat + geocode fallback
  via `searchPlaces` → `nearestStation()` (≤ transitWalkKm) + `station`/`distanceM` + must-verify
  via scrape + sort terdekat (filter keras, gagal geocode = dibuang dalam mode koridor).
- `research-honesty.test.ts`: kasus baru job koridor (Serpong keep + station, Medan dibuang).
- Kartu `ResearchToolOutput`: badge verified (✓/✗/?), jarak/stasiun, `limitations` jujur;
  `maps-output.tsx` `PlaceCard` rating berattribusi (tanpa sumber = `(?)`).
- OSM-only penuh: `google.ts` shim, `settings/usage` no-op, Settings → Maps tanpa key,
  `links.ts` keyless tetap.

## 2.0.15-fork.6 (2026-10-04)

`research_deep` terintegrasi + OSM-only penuh (jawaban ngaco Sudirman/carport/KRL diperbaiki di lapisan data):

- `research_deep`: `constraints.ts` (carport = filter keras, KRL Rangkasbitung = koridor jalan 1 km, anchor-from-query),
  `transit.ts` (19 stasiun Tanah Abang→Rangkasbitung + `nearestStation`), `orchestrate.ts`
  (extract→anchor-resolve→search→koridor/radius→scrape-verify→SearchOut + limitations), tool `research_deep`
  (permission `research.deep`), honesty schema/test.
- `maps/search.ts`: `anchor`/`radiusKm` + filter radius Karney + sort + `distanceM` (yang jauh dibuang beneran).
- `jobs.ts`: tanpa `OPENCODE_JOBS_API_URL` fallback web-search ber-lokasi (tidak `ToolFailure` buta).
- OSM-only: `google.ts` jadi shim (throw jujur), `settings.ts`/`usage.ts` no-op OSM, Settings → Maps tanpa
  section key/limit/test, i18n `settings.maps.google*` dihapus, `links.ts` keyless tetap (tombol + transit directions).
- Rich-info keyless: `enrich.ts` (`ogImage`, `contactFrom`, `ratingFromScrape`) — rating/review/foto hanya
  bila OSM/Wikimedia/scrape berattribusi, else `unknown` (tidak pernah ngarang).
- Kontrak jawaban: `core/geo` + `response/contract` (pipeline wajib, tabel Nama|Jarak/Waktu|Harga|Verifikasi|Sumber,
  badge ✓/✗/?, `map_show` di akhir); kartu UI (`ResearchToolOutput`, `maps-output`) tampilkan jarak/stasiun/badge/tanggal cek.

## 2.0.15-fork.5 (2026-10-03, foundation — OSM-only + cards follow)

Fondasi `research_deep` + scraper-first yang terintegrasi (jawaban ngaco Sudirman/carport/KRL diperbaiki di lapisan data):

- `research_deep`: `constraints.ts` (carport = filter keras, KRL Rangkasbitung = koridor jalan 1 km),
  `transit.ts` (19 stasiun Tanah Abang→Rangkasbitung + `nearestStation`), `orchestrate.ts`
  (extract→anchor→search→koridor→scrape-verify→SearchOut), tool `research_deep` + honesty schema/test.
- `maps/search.ts`: `anchor`/`radiusKm` + filter radius Karney + sort + `distanceM` (yang jauh dibuang beneran).
- `jobs.ts`: tanpa `OPENCODE_JOBS_API_URL` fallback web-search ber-lokasi (tidak `ToolFailure` buta).
- Explicit BELUM di rilis ini: OSM-only removal, rich-info workaround, kontrak prompt, kartu UI,
  live 3 kasus — menyusul sebelum closeout fork.5.

## 2.0.15-fork.4 (2026-10-02)

Repair `memory` yang hilang di DB: jurnal migrasi `m48` completed tapi tabel
fisik tidak ada (snapshot drizzle basi) → migrasi repair idempotent
`20261002082455_icy_meggan` + regenerasi `schema.json`/`schema.gen.ts`
(`--check` hijau). Backfill 576 vault entries → DB. `memory_save/search/forget`
bisa dipakai di prod.

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.3-backfill (2026-10-02, staged — belum rilis)

Penutup 5% sisa fork.3: tidak ada perubahan runtime, hanya backfill + docs.

- Vault `C:/Users/fadhi/Documents/Obsidian/opencode-memory` terisi penuh:
  142 session notes + 576 entries + 56 project notes (opencode 43, cline 8,
  claude transcripts 25, claude-code 55, claude-desktop 11; deterministik tanpa
  LLM; full transcript tidak dicopy). Lihat `docs/MEMORY_OBSIDIAN.md` § Backfill.
- Baru (staged): `packages/core/src/memory/import.ts`
  (`summarizeDeterministic`, `readClaudeCodeFile`, `readClineFile`,
  `readInboxFile`, `fingerprint`) + `packages/core/test/memory-import.test.ts`.
- Betulkan link `handoff.md` → `../../opencode-app/handoff.md` (2 baris).
- Belum: tabel `memory` di DB prod (butuh restart `4096` sekali agar migrasi
  `20261001000000` jalan, lalu verifikasi `memory_search` live).

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.3 (2026-10-02)

### Smarter answers, no more loops
- Replies follow a short structure (summary, details, files, verify, next) and never invent ratings, prices, or hours the tools did not return.
- The runner stops nagging after 2 unconfirmed-completion retries instead of looping.

### Memory (Obsidian vault)
- New tools: `memory_save`, `memory_search`, `memory_forget` (all ask-first, permission `memory.*`).
- Vault-backed recall (max 4KB) in the system prompt; an empty vault changes nothing. Compaction proposes Memory Candidates.
- Settings → Memory: vault directory + auto-save preference. The vault is plain markdown so other agents can share it.

### Ultimate scraper (`scrape_fetch` / `scrape_status`)
- One tool for chat, code, and classifier: fast (webfetch) → stealth (camofox → scrapling) → AI (scrapegraph) → channels (agent-reach); first success wins with a warning trail.
- Camofox works without VS Build Tools via the python `camoufox` backend (verified live); the node REST server stays optional.
- Scrapegraph uses `scrapegraphai` + the 9router key; it skips honestly without a key. Auto-setup via uv, kill-switch `OPENCODE_SCRAPER_NO_AUTOSETUP=1`.
- Settings → Scraper: default mode, auto-setup, per-engine status.

### Classifier (renamed from Laya)
- Chat/Code/Classifier view modes; `classifier_classify` plus a deprecated `laya_classify` alias for one release.
- Removed the in-composer guide note; clearer deterministic-mode messages (no raw `noul`/platform text to the user).

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.2 (2026-10-01)

- Chat quotes and notes capture the whole selection, even with a slow drag. Before, a pause during the drag kept
  only the first word.
- The quoted text stays highlighted while you write the note. The note box shows exactly what will be quoted
  and sits below the selection.
- The composer chip shows the quoted text, with the full quote and note on hover.
- The canvas plugin (outside the repo, `~/.config/opencode/plugins/opencode-preview`) no longer hangs a turn when
  two projects start the canvas at once. See `../../opencode-app/handoff.md`.

## 2.0.15-fork.1 (2026-09-30)

This is the first versioned release. It is based on upstream opencode v2.0.15 plus Cline's chat stack.

### v1 UX restored on v2
- v1 look and layout, Chat, Code and Laya view modes, topics and side chat.
- A web Browser pane with a loopback direct frame and the annotator.
- Generated-file cards with download and preview, and pdf.js PDF preview.
- Timeline freeze fix for 75% zoom (the virtualizer settle tolerance).
- The file-card black screen fix: no `createResource` in the timeline.

### Launcher and Windows
- The launcher signs in without a Basic-auth prompt.
- Plugins no longer open console windows, and Playwright runs headless.
- IDM no longer hijacks previews:
  - file reads go to `/api/fs/read/~b64~<base64url>` and return `application/octet-stream`
  - sounds are inlined
- An open window offers a "new version, Reload" toast after each deploy.

### Chat
- `[[OPENCODE_TASK_COMPLETE]]` is hidden. The runner still uses it.
- Canvas output from the opencode-preview and opencode-artifacts plugins opens in a side-panel tab, not a
  browser window.

### Maps and spatial analysis (free only)
- Tools:
  - `maps_search`, `maps_ask`, `maps_route`, `maps_matrix`, `maps_poi` and `map_show`.
  - `geo_compute`, which covers geodesics, UTM, buffers, hulls, DBSCAN, ranking, classification (best of Jenks,
    quantile, equal, std-dev and head/tail by GVF), Moran's I, Getis-Ord Gi*, Clark–Evans and centrography.
- Data sources:
  - OpenStreetMap: Nominatim (preferring POIs), Photon, OSRM and Overpass.
  - Free enrichment: OSM hours, stars and contacts, plus Wikimedia photos whose title names the place.
  - Google Maps via the Gemini free tier: disabled for new keys (2.5 models retired), falls back to OSM, never
    billed.
- Settings → Maps:
  - key, a free-tier confirmation and daily-limit guard
  - a "429 means stop for the day" rule
- The Research providers block is collapsed and points to Maps.
- UI:
  - A Map tab in the side panel with numbered pins, name chips and a card strip. It opens on the first result.
  - Gemini-style inline place cards in replies.
  - A photo carousel in tool cards.
- Research for place, hotel and event queries uses Maps. The Laya fallback follows a spatial ranking.

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

