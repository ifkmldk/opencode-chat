# Memory + Obsidian vault (fork)

Vault-backed memory shared across sessions. The vault is plain Obsidian
markdown so Claude, Cursor, Codex, and other agents can read/write the same
single source of truth.

## Tools (all `codemode: false`, permission `memory.*`)

- `memory_save {scope, kind, title, body}` — store a fact, preference,
  decision, or correction. Ask the user before saving unless they asked to
  remember. Scopes: `global` | `project` | `session`. Bodies cap at 2000 chars.
- `memory_search {query, scope?, limit?}` — recall (LIKE + recency, max 20).
- `memory_forget {id}` — delete by id.

## Prompt injection

`core/memory` instructions inject at most 4KB / 8 entries as
`## Remembered context (vault)` with `(memory:<id-prefix>)` cites. An empty
vault injects nothing (zero behavior change). Compaction proposes
`## Memory Candidates`; the model still asks before calling `memory_save`.

## Vault layout

```
<vault>/
  global.md
  projects/<projectID>.md
  sessions/<YYYY-MM-DD>.md
  entries/<ulid>.md   # frontmatter: id/kind/scope/updated/source
```

Round-trip helpers live in `packages/core/src/memory/obsidian-sync.ts`
(`toMarkdown`/`fromMarkdown`/`hashFile`, `gray-matter`). Storage is the
`memory` SQLite table (migration `20261001000000_memory_table`); the vault
is the human-readable mirror. Default dir:
`C:/Users/fadhi/Documents/Obsidian/opencode-memory` (change in
Settings → Memory; empty means DB-only).

## Backfill — impor semua session (2026-10-02, 142 session notes + 576 entries)

Vault sudah di-setup dan diisi dari SEMUA session yang ada di disk:

| Sumber | Jumlah | Keterangan |
| --- | --- | --- |
| opencode `session_v2` (custom-main 12 + opencode.db 31) | 43 notes | SQLite read-only |
| cline `~/.cline/data/sessions` | 8 notes | `*.messages.json` |
| claude transcripts `~/.claude/transcripts` | 25 notes | `ses_*.jsonl` user-only (1 skip noise) |
| claude-code `~/.claude/projects` (503 jsonl, cap 600 file *baru*, 400 baris/file, skip thinking/tool noise) | 55 notes | 9 skip |
| claude-desktop `claude-code-sessions/*/local_*.json` | 11 notes | metadata saja |
| **Total** | **142 notes → 576 entries** | deterministik tanpa LLM |

Ringkasan per session: topik awal + perkembangan + keputusan/preferensi/koreksi
(max 6 facts, `body≤2000`, `title≤120`, `source:"import"`). Full transcript
TIDAK dicopy; `external_id` menunjuk file asli. Struktur: `sessions/`,
`projects/` (69 proyek, 1 note/proyek → `[[sessions/...]]`), `entries/`
(1 note/fact, frontmatter `id/kind/scope/updated/source`), `inbox/` (export
manual), `_meta/import-log.md`.

Codex/Gemini/Qwen/Kimi/DeepSeek/Perplexity/Cursor/LibreChat tidak ditemukan di
disk (kemungkinan web-only) → export manual dari web UI ke `inbox/` lalu
jalankan importer tahap inbox. Rerun importer idempotent (skip bila note ada,
hash compare).

## Cara baca lintas agent

- opencode: `memory_search <kata kunci>` + recall otomatis ≤4KB.
- claude code/chat, cline, codex, cursor: buka vault langsung
  (`global.md` → `projects/` → `sessions/`), atau grep `entries/`.
  Tambahkan pointer di `CLAUDE.md`/`AGENTS.md` masing-masing repo:
  `Memori lintas sesi: C:/Users/fadhi/Documents/Obsidian/opencode-memory`.
