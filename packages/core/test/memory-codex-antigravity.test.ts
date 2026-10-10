import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryCodex } from "../src/memory/codex"
import { MemoryAntigravity } from "../src/memory/antigravity"

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agents-"))

describe("Codex reader", () => {
  test("missing database returns nothing", () => {
    expect(MemoryCodex.read(tmp())).toEqual([])
  })

  test("reads threads from the database and messages from the rollout file", () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
    const rollout = path.join(home, "rollout.jsonl")
    fs.writeFileSync(rollout, [
      JSON.stringify({ payload: { role: "user", content: [{ type: "input_text", text: "pertanyaan codex satu" }] } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
      JSON.stringify({ payload: { role: "assistant", content: [{ type: "output_text", text: "jawaban codex" }] } }),
      "not json at all",
    ].join("\n"))
    const db = new Database(path.join(home, ".codex", "state_5.sqlite"))
    db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '')`)
    db.query("INSERT INTO threads VALUES (?,?,?,?,?,?,?)").run("t1", rollout, 1700000000, 1700000100, "C:/proj", "Judul codex", "pertanyaan codex satu")
    db.query("INSERT INTO threads VALUES (?,?,?,?,?,?,?)").run("t2", path.join(home, "gone.jsonl"), 1700000000, 1700000200, "C:/proj", "", "fallback pesan pertama")
    db.close()
    const sessions = MemoryCodex.read(home)
    expect(sessions.map((s) => s.id).sort()).toEqual(["t1", "t2"])
    const t1 = sessions.find((s) => s.id === "t1")!
    expect(t1.turns.map((t) => t.role)).toEqual(["user", "assistant"])
    expect(t1.turns[1]!.text).toBe("jawaban codex")
    const t2 = sessions.find((s) => s.id === "t2")!
    expect(t2.turns[0]!.text).toBe("fallback pesan pertama")
    fs.rmSync(home, { recursive: true, force: true })
  })

  test("source database is left untouched (copied before reading)", () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
    const file = path.join(home, ".codex", "state_5.sqlite")
    const db = new Database(file)
    db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '')`)
    db.close()
    const before = fs.statSync(file).mtimeMs
    MemoryCodex.read(home)
    expect(fs.statSync(file).mtimeMs).toBe(before)
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe("Antigravity reader", () => {
  test("missing database returns nothing", () => {
    expect(MemoryAntigravity.read(tmp())).toEqual([])
  })

  test("one note per conversation with a request, skips empty rows", () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, ".gemini", "antigravity"), { recursive: true })
    const db = new Database(path.join(home, ".gemini", "antigravity", "conversation_summaries.db"))
    db.exec(`CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', last_modified_time TEXT NOT NULL, last_user_input_time TEXT NOT NULL, workspace_uris TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', agent_name TEXT NOT NULL DEFAULT '')`)
    db.query("INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?,?)").run("c1", "Judul AG", "tanya antigravity", "2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z", "file:///proj", "IDLE", "agent")
    db.query("INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?,?)").run("c2", "", "", "2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z", "", "", "")
    db.close()
    const sessions = MemoryAntigravity.read(home)
    expect(sessions.map((s) => s.id)).toEqual(["c1"])
    expect(sessions[0]!.turns[0]!.text).toBe("tanya antigravity")
    fs.rmSync(home, { recursive: true, force: true })
  })
})
