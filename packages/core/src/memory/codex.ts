export * as MemoryCodex from "./codex.js"

import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Parsed, Turn } from "./sessions.js"

// fork: Codex desktop/CLI threads. The thread list is in ~/.codex/state_5.sqlite (table `threads`), each thread points at a
// rollout file (JSONL) with the messages. The database is copied first, so Codex keeps writing to its own copy undisturbed.

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n")
}

/** Messages of one rollout file. Lines that are not user/assistant messages are skipped. */
export function parseRollout(file: string): Turn[] {
  const turns: Turn[] = []
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const item = record.payload && typeof record.payload === "object" ? record.payload : record
    const role = item.role
    if (role !== "user" && role !== "assistant") continue
    const text = textOf(item.content).trim()
    if (!text) continue
    turns.push({ role, text, tools: [] })
  }
  return turns
}

/** Conversations from Codex's thread list; the rollout file gives the messages, the first user message is the fallback. */
export function read(home = os.homedir()): Parsed[] {
  const source = path.join(home, ".codex", "state_5.sqlite")
  if (!fs.existsSync(source)) return []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-snap-"))
  try {
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, path.join(dir, "state_5.sqlite" + suffix))
    const db = new Database(path.join(dir, "state_5.sqlite"), { readonly: true })
    const rows = db.query("SELECT id, rollout_path, created_at, updated_at, cwd, title, first_user_message FROM threads ORDER BY updated_at").all() as Array<{
      id: string
      rollout_path: string
      created_at: number
      updated_at: number
      cwd: string
      title: string
      first_user_message: string
    }>
    db.close()
    return rows.flatMap((row) => {
      const turns = row.rollout_path && fs.existsSync(row.rollout_path) ? parseRollout(row.rollout_path) : []
      if (turns.length === 0 && row.first_user_message) turns.push({ role: "user", text: row.first_user_message, tools: [] })
      if (!turns.some((turn) => turn.role === "user")) return []
      const started = row.created_at * 1000
      const ended = row.updated_at * 1000
      return [{ agent: "codex" as const, id: row.id, title: row.title || row.first_user_message.slice(0, 80), cwd: row.cwd, started, ended, turns, files: [] }]
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
