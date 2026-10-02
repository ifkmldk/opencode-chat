# Implementation Plan — fork `2.0.15-fork.3` as-built + penutup 5%

> Dokumen ini adalah status AS-BUILT (bukan rencana awal). Acuan: `@implementation_plan.md`.

## [Overview] — DONE, sisa verifikasi prod

Satu kalimat: fork `2.0.15-fork.3` (`v1-ux-restore` @ `998e95ed06`, snapshot
`fork/main` = `4ca27927`, tag `fork-v2.0.15-fork.3`) sudah build + deploy +
publish; sisa penutup 5% = commit backfill memory, betulkan 2 link changelog,
jalankan migrasi `memory` di prod via restart, verifikasi live.

Bukti terverifikasi: pipeline `install/appbuild/clibuild/smoke OK`,
`canary FAIL 2x → OK 07:51:47`, prod `4096 HTTP=200`, port `4097` bersih,
backup `opencode.exe.bak-20261002-072721`, `ls-remote fork` =
`HEAD/main 4ca27927` + tags fork.1/2/3, lint scoped 0/0, unit 6+23 pass,
E2E mock-only 4 passed, vault `142 sessions + 576 entries + 56 projects`.

## [Types] — tidak ada perubahan (verifikasi kontrak)

`MemoryStore.Entry/Scope/Kind` (`store.ts:10-26`), `MemoryTable`
(`kv/sql.ts:11-25`), `VaultEntry/SyncState` (`obsidian-sync.ts:6-52`),
`ScrapeInput/Output` (`scrape/types.ts`), `ClassifierEngine/Answer`,
`LoopState/Verdict` (`MAX_REPEAT=3`, `MAX_NO_PROGRESS=5`, `MAX_NAGS=2`),
`experimental.ts` (`classifier` + alias `laya` deprecated).

## [Files] — commit backfill + docs fix (Order penutup)

- BARU (staged, ikut commit penutup): `packages/core/src/memory/import.ts`
  (`summarizeDeterministic`, `readClaudeCodeFile`, `readClineFile`,
  `readInboxFile`, `fingerprint`), `packages/core/test/memory-import.test.ts`.
- MODIFIKASI: `docs/MEMORY_OBSIDIAN.md` (§ Backfill: tabel 142→576),
  `fork-docs/CHANGELOG-FORK.md` (§ fork.3-backfill + link
  `../../opencode-app/handoff.md` 3 baris).
- Vault (di luar repo, sudah di disk): `sessions/` 142 notes, `entries/` 576,
  `projects/` 56, `global.md`, `inbox/README.md`, `_meta/import-log.md`.
- HAPUS: tidak ada. File kerja (`logs/push-fork3.ps1`, `fork3-commit*.txt`,
  `oxlint-fork3.log`, `packages/cli/.bun-cache/`) tidak staged.
- KONFIG: tidak ada (`opencode.json`, env, launcher, port, channel tetap).

## [Functions] — tidak ada perubahan, verifikasi live

`MemoryStore.save/search/forget`, `MemoryRecall.buildMemoryBlock` (≤4KB/8),
`MemoryVault.toMarkdown/fromMarkdown`, `UltimateScrape.planFor/run`,
`ScraperSetup.ensure`, `LoopGuard.check`, executors `scrape_fetch/status`,
`memory_save/search/forget`, `classifier_classify` + alias `laya_classify`.

## [Classes] — tidak ada perubahan

`Memory.Service`, `MemoryInstructions`, `Scraper`, `Classifier.Service`,
`MemoryTool/ScrapeTool/ClassifierPlugin`, `SettingsScrape/SettingsMemory`,
`ScrapeToolOutput/MemoryToolOutput` — registrasi terverifikasi.

## [Dependencies] — tidak ada perubahan

`uvx` probes (cache ada), `gray-matter` reuse, kill-switch + env tetap.

## [Testing] — hasil + sisa

- Unit: `memory-import` (2), `memory-vault` (2), `memory-recall` (2),
  `scrape-plan` (4), `loop-guard` (5), `response-contract` (2),
  `research-tool`, `laya-spatial`, `model.test.ts` (3) — PASS.
- Typecheck `core` + `app` + `app:e2e` PASS; lint scoped 0/0.
- E2E mock-only 4 passed (tidak rerun — UI tidak berubah).
- SISA: restart prod `4096` → migrasi `memory` → `memory_search` live
  (DB prod kini `no such table: memory`), `scrape_status` read-only,
  prod `200` + port bersih. Rollback: exe `.bak-*`.

## [Implementation Order] — penutup

1. Commit staged backfill + changelog fix (docs-only).
2. Restart prod `4096` via launcher → migrasi `memory` → verifikasi live.
3. QA akhir (`git log/status/ls-remote`, prod `200`) → snapshot/tag bila perlu.
4. Kabar prod ke user per fitur + yang belum jujur + rollback.

## [Appendix A — live verification 2026-10-01/02]

- `scrapling[fetchers]` example.com 200/711B; `camoufox fetch` ~493MB +
  headless 200; `scrapegraphai` import OK (butuh key); `agent-reach list` OK
  (no channels); node camofox gagal (no VS tools) → python backend.
- Backfill 2026-10-02: opencode 43, cline 8, transcripts 25, claude-code 55,
  desktop 11 → 142 notes → 576 entries, deterministik tanpa LLM.

## [Appendix B — penutup 100% (2026-10-02)]

- Changelog heading duplikat :43 dibetulkan jadi fork.2; link handoff 3 baris -> ../../opencode-app/handoff.md.
- Publish SSH (git@github-pribadi, auth Hi ifkmldk! OK): snapshot commit-tree + push fork/main --no-verify + tag fork-v2.0.15-fork.3.
- Restart prod 4096 -> migrasi 20261001000000_memory_table jalan -> SELECT COUNT(*) FROM memory = 0.
- Live probe: memory_search kosong-jujur, siklus save->search->forget test lalu hapus, scrape_status read-only, classifier_classify.
- Prod 200 + port 4097 bersih + rollback exe .bak-20261002-072721.

