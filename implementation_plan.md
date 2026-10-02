# Implementation Plan — fork `2.0.15-fork.4` closeout

## [Overview]

Menutup rilis `2.0.15-fork.4`: kode repair sudah commit dan idempotent
(`fd22004e50`), tapi build-deploy-publish belum jalan, sehingga
prod masih exe lama tanpa tabel `memory`. Scope hanya penutup:
unblock build, 1x pipeline sekuensial, verifikasi `memory` +
backfill 576 entries, publish via SSH, kabar prod. Tanpa ubah
flow/UI/arsitektur dan isi vault.

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


## [Appendix C — kenapa belum beres 2026-10-02 sore + unblock]

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

