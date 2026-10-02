#!/usr/bin/env bun
// fork: one-shot vault→DB backfill. Reads entries/*.md via fromMarkdown,
// INSERT OR IGNORE with the vault id so (memory:xxxxxxxx) cites stay stable.
// Rerun-safe: existing ids are skipped. Usage:
//   bun run script/memory-backfill.ts --vault C:/Users/fadhi/Documents/Obsidian/opencode-memory --db "C:/Users/fadhi/.local/share/opencode/opencode-v1-ux-restore.db"
import { readdir, readFile } from "fs/promises"
import { join } from "path"
import { parseArgs } from "util"
import { Database } from "bun:sqlite"
import { fromMarkdown } from "../src/memory/obsidian-sync.js"

const args = parseArgs({ args: process.argv.slice(2), options: { vault: { type: "string" }, db: { type: "string" } } })
const vault = args.values.vault ?? "C:/Users/fadhi/Documents/Obsidian/opencode-memory"
const dbPath = args.values.db
if (!dbPath) throw new Error("Pass --db <path-to-opencode.db>")

const files = (await readdir(join(vault, "entries"))).filter((f) => f.endsWith(".md"))
const db = new Database(dbPath, { create: false, readwrite: true })
const insert = db.prepare(
  `INSERT OR IGNORE INTO memory (id, scope, kind, title, body, project_id, session_id, source, time_created, time_updated) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
)
let saved = 0
let skipped = 0
let errors = 0
const skippedIds: string[] = []
const now = Date.now()
for (const file of files) {
  try {
    const id = file.replace(/\.md$/, "")
    const raw = await readFile(join(vault, "entries", file), "utf8")
    const entry = fromMarkdown(id, raw)
    if (!entry) {
      skipped++
      if (skippedIds.length < 5) skippedIds.push(id)
      continue
    }
    const changed = insert.run(entry.id, entry.scope, entry.kind, entry.title, entry.body, entry.source, entry.updated || now, now)
    if (Number(changed.changes) > 0) saved++
    else skipped++
  } catch {
    errors++
  }
}
db.close()
console.log(JSON.stringify({ files: files.length, saved, skipped, errors, skippedIds }))
