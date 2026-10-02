# Implementation Plan — fork `2.0.15-fork.4`: repair tabel `memory` + publish + verifikasi prod

## [Overview]

Satu kalimat: memperbaiki bug tabel `memory` hilang di DB prod (jurnal migrasi `m48` completed tapi tabel fisik tidak ada) lewat migrasi repair idempotent + regenerasi snapshot drizzle, lalu rilis `2.0.15-fork.4`, backfill 576 vault entries ke DB, publish via SSH, redeploy pipeline, dan verifikasi live sampai prod 100% bisa dipakai.

Scope: hanya lapisan DB-migrasi + snapshot + versioning + deploy; tanpa ubah flow/UI/arsitektur, tanpa ubah isi vault, tanpa tulis ke DB sumber impor. Root cause terverifikasi: `schema.gen.ts` (280 baris) dan `schema.json` (2067 baris) tidak mengandung `memory` karena snapshot tidak pernah diregenerasi setelah `MemoryTable` ditambah di `kv/sql.ts:11-25`; jalur bootstrap `migration.ts:22-52` menandai semua id completed tanpa menjalankan `up()` per migrasi, sehingga DB baru (dibuat canary 07:20:02) tidak pernah dapat tabelnya — restart saja tidak akan pernah memperbaiki. Pendekatan: regenerasi snapshot via `bun run migration`, tambah migrasi repair `m49` (`IF NOT EXISTS`), bump fork.4, backfill vault→DB (`INSERT OR IGNORE`, id asli dipertahankan), publish snapshot+tag ifkmldk-only, redeploy `pipeline.ps1`, verifikasi live + kabar prod.

## [Types]

Tidak ada perubahan type system; yang diselaraskan hanya snapshot + jurnal.
`MemoryTable` (`packages/core/src/kv/sql.ts:11-25`, tidak diubah), `schema.json` + `schema.gen.ts` diregenerasi agar memuat `memory` + index, `migration.gen.ts` tambah `m49` setelah `m48` (`m00–m48` dan id `m48` tidak diubah). Kontrak lain (`MemoryStore.Entry/Scope/Kind`, `VaultEntry/SyncState`, `ScrapeInput/Output`, `ClassifierEngine/Answer`, `LoopState/Verdict` 3/5/2) tidak berubah.

## [Files]

BARU (fork-owned): `packages/core/src/database/migration/<repair>.ts` (idempotent `CREATE TABLE IF NOT EXISTS memory` + `CREATE INDEX IF NOT EXISTS`, kolom persis `kv/sql.ts`; file baru karena jurnal prod sudah menandai `m48` completed sehingga edit `m48` tidak akan dieksekusi), `packages/core/test/memory-repair.test.ts` (idempotency 2x + insert/select), `packages/core/script/memory-backfill.ts` (baca `entries/*.md` via `fromMarkdown`, `INSERT OR IGNORE` dengan id asli vault agar sitasi `(memory:xxxxxxxx)` sama).

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

