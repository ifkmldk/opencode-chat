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
