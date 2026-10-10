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
import { MemoryGemini } from "../src/memory/gemini"
import { MemoryDigest } from "../src/memory/digest"
import { MemoryIndex } from "../src/memory/index"
import { MemoryCodex } from "../src/memory/codex"
import { MemoryAntigravity } from "../src/memory/antigravity"

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
  // fork: Gemini comes from Google Takeout zips in the folder below; re-imported each run (the zips are the source of truth).
  const takeout = process.env.GEMINI_TAKEOUT_DIR ?? "D:/Documents/Default Project"
  const gemini = fs.existsSync(takeout) ? MemoryGemini.importTo(vault, takeout) : { sessions: 0, errors: [] as string[] }
  result.errors.push(...gemini.errors)
  // fork: Codex threads and Antigravity conversations, copied from their own databases each run; each becomes a session note.
  const secrets = MemorySessions.knownSecrets()
  let apps = 0
  for (const session of [...MemoryCodex.read(), ...MemoryAntigravity.read()]) {
    try {
      MemorySessions.writeNote(vault, session, secrets)
      apps++
    } catch (error) {
      result.errors.push(`${session.agent} ${session.id}: ${(error as Error).message}`.slice(0, 200))
    }
  }
  // fork: refresh the memory digest inside each agent's global instructions file, so every new session starts with it.
  const digest = MemoryDigest.build(vault)
  const written: string[] = []
  for (const target of MemoryDigest.targets()) {
    try {
      if (MemoryDigest.write(target.file, digest)) written.push(target.agent)
    } catch (error) {
      result.errors.push(`digest ${target.agent}: ${(error as Error).message}`.slice(0, 200))
    }
  }
  // fork: full-text index over sessions, transcripts and entries, used by the per-prompt recall hook.
  const index = MemoryIndex.build(vault)
  const line = `${new Date().toISOString()} claude=${result.claude} subagents=${result.subagents} claudeMemory=${result.claudeMemory} opencode=${result.opencode} cline=${result.cline} gemini=${gemini.sessions} codexAntigravity=${apps} skipped=${result.skipped} errors=${result.errors.length} ms=${Date.now() - started}`
  fs.appendFileSync(path.join(vault, ".sync", "log.txt"), `${line}\n${result.errors.map((error) => `  ${error}`).join("\n")}${result.errors.length ? "\n" : ""}`)
  console.log(line)
} finally {
  fs.rmSync(lock, { force: true })
}
