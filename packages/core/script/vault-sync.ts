#!/usr/bin/env bun
// fork: copies Claude Code sessions, Claude Code memory notes and OpenCode sessions into the Obsidian vault (summaries for
// recall, full transcripts for search), secrets removed. Incremental and safe to run often. Run by the launcher when the
// app opens and by a Claude Code SessionEnd hook; a lock file keeps two runs from overlapping.
//
//   bun packages/core/script/vault-sync.ts [--limit N]

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemorySessions } from "../src/memory/sessions"
import { MemoryVaultFiles } from "../src/memory/vault"

const config = path.join(os.homedir(), ".config", "opencode")
const vault = MemoryVaultFiles.settings(config).dir
if (!vault) {
  console.error("No Obsidian vault found (OPENCODE_MEMORY_VAULT, memory.json or ~/Documents/Obsidian/opencode-memory/entries).")
  process.exit(0)
}
const lock = path.join(vault, ".sync", "lock")
fs.mkdirSync(path.dirname(lock), { recursive: true })
try {
  const age = Date.now() - fs.statSync(lock).mtimeMs
  if (age < 30 * 60_000) {
    console.error("Another sync is running.")
    process.exit(0)
  }
} catch {
  // no lock
}
fs.writeFileSync(lock, String(process.pid))
try {
  const limitArg = process.argv.indexOf("--limit")
  const started = Date.now()
  const result = MemorySessions.sync({
    vault,
    opencodeDBs: MemorySessions.opencodeDatabases(),
    ...(limitArg > 0 ? { limit: Number(process.argv[limitArg + 1]) } : {}),
  })
  const line = `${new Date().toISOString()} claude=${result.claude} subagents=${result.subagents} claudeMemory=${result.claudeMemory} opencode=${result.opencode} skipped=${result.skipped} errors=${result.errors.length} ms=${Date.now() - started}`
  fs.appendFileSync(path.join(vault, ".sync", "log.txt"), `${line}\n${result.errors.map((error) => `  ${error}`).join("\n")}${result.errors.length ? "\n" : ""}`)
  console.log(line)
} finally {
  fs.rmSync(lock, { force: true })
}
