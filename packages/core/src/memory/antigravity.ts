export * as MemoryAntigravity from "./antigravity.js"

import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Parsed } from "./sessions.js"

// fork: Antigravity conversations. The summary table ~/.gemini/antigravity/conversation_summaries.db lists every conversation
// (title, preview, times, workspace). The database is copied first, so Antigravity keeps using its own copy undisturbed.

/** One note per Antigravity conversation. The full message content is not stored as plain text in this database. */
export function read(home = os.homedir()): Parsed[] {
  const source = path.join(home, ".gemini", "antigravity", "conversation_summaries.db")
  if (!fs.existsSync(source)) return []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-snap-"))
  try {
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, path.join(dir, "conversation_summaries.db" + suffix))
    const db = new Database(path.join(dir, "conversation_summaries.db"), { readonly: true })
    const rows = db
      .query(
        "SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris, status, agent_name FROM conversation_summaries ORDER BY last_modified_time",
      )
      .all() as Array<{ conversation_id: string; title: string; preview: string; last_modified_time: string; last_user_input_time: string; workspace_uris: string; status: string; agent_name: string }>
    db.close()
    return rows.flatMap((row) => {
      const ask = (row.preview || row.title || "").trim()
      if (!ask) return []
      const started = Date.parse(row.last_user_input_time) || Date.parse(row.last_modified_time) || 0
      const ended = Date.parse(row.last_modified_time) || started
      const cwd = row.workspace_uris || ""
      const body = [`Status: ${row.status || "-"} · Agent: ${row.agent_name || "-"} · Workspace: ${cwd || "-"}`, "", row.preview || row.title]
      return [
        {
          agent: "antigravity" as const,
          id: row.conversation_id,
          title: row.title || ask.slice(0, 80),
          cwd,
          started,
          ended,
          turns: [
            { role: "user" as const, text: ask, tools: [] },
            { role: "assistant" as const, text: body.join("\n"), tools: [] },
          ],
          files: [],
        },
      ]
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
