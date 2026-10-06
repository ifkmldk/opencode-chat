#!/usr/bin/env bun
// fork: brings every session from the older OpenCode databases (other channels, the v1 layout) into one database. It only
// adds: a session, message or project that already exists in the target is never touched, and nothing is deleted. v2 rows
// are copied as they are (the same steps as V1Migration's opencode-next import); v1 sessions go through
// V1Migration.transformSession, the converter the server itself uses.
//
//   bun packages/core/script/merge-sessions.ts <target.db> <source.db> [<source.db> ...]
//
// Run it on a copy while no server uses the target, check the copy, then swap it in.

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { V1Migration } from "../src/database/v1-migration.bun"

const [targetPath, ...sources] = process.argv.slice(2)
if (!targetPath || sources.length === 0) throw new Error("usage: merge-sessions.ts <target.db> <source.db> [...]")

const target = new Database(targetPath)
const columns = (db: Database, table: string) => (db.query(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
const tables = (db: Database) => new Set((db.query("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
const has = (table: string, id: string) => !!target.query(`select 1 from ${table} where id = ?`).get(id)

const targetSession = columns(target, "session_v2")
const targetProject = columns(target, "project")
const report: Record<string, { projects: number; v2: number; v1: number; messages: number; skipped: number; warnings: number }> = {}

/** Inserts `row` into `table` using only the columns both sides have; returns false when the id already exists. */
const insert = (table: string, wanted: string[], row: Record<string, unknown>, defaults: Record<string, unknown> = {}) => {
  if (has(table, String(row.id))) return false
  const values = { ...defaults, ...Object.fromEntries(Object.entries(row).filter(([key, value]) => wanted.includes(key) && value !== undefined)) }
  const keys = Object.keys(values).filter((key) => wanted.includes(key))
  target.query(`insert into ${table} (${keys.join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...(keys.map((key) => values[key]) as never[]))
  return true
}

const sequence = (sessionID: string, seq: number) =>
  target.query("insert into event_sequence (aggregate_id, seq, owner_id) values (?, ?, null) on conflict(aggregate_id) do nothing").run(sessionID, seq)

for (const sourcePath of sources) {
  if (!existsSync(sourcePath)) continue
  const source = new Database(sourcePath, { readonly: true })
  const present = tables(source)
  const counts = { projects: 0, v2: 0, v1: 0, messages: 0, skipped: 0, warnings: 0 }
  report[sourcePath] = counts
  target.run("begin")
  try {
    if (present.has("project")) {
      for (const project of source.query("select * from project").all() as Array<Record<string, unknown>>) {
        if (insert("project", targetProject, project, { time_active: project.time_updated ?? Date.now(), sandboxes: "[]" })) counts.projects++
      }
    }
    const projectIDs = new Set((target.query("select id from project").all() as Array<{ id: string }>).map((row) => row.id))
    const ensureGlobal = () => {
      if (projectIDs.has("global")) return
      target.query("insert or ignore into project (id, worktree, time_created, time_updated, time_active, sandboxes) values ('global', 'C:\\', ?, ?, ?, '[]')").run(Date.now(), Date.now(), Date.now())
      projectIDs.add("global")
    }
    if (present.has("session_v2") && present.has("session_message")) {
      for (const session of source.query("select * from session_v2 order by time_created").all() as Array<Record<string, unknown>>) {
        const id = String(session.id)
        if (has("session_v2", id)) {
          counts.skipped++
          continue
        }
        if (!projectIDs.has(String(session.project_id))) {
          ensureGlobal()
          session.project_id = "global"
        }
        insert("session_v2", targetSession, session)
        const messages = source.query("select * from session_message where session_id = ? order by seq").all(id) as Array<Record<string, unknown>>
        for (const message of messages) {
          target.query("insert or ignore into session_message (id, session_id, type, seq, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?, ?)").run(
            message.id as string, message.session_id as string, message.type as string, message.seq as number, message.time_created as number, message.time_updated as number, message.data as string,
          )
        }
        sequence(id, Number(messages.at(-1)?.seq ?? -1))
        counts.v2++
        counts.messages += messages.length
      }
    }
    if (present.has("session") && present.has("message") && present.has("part")) {
      for (const session of source.query("select * from session order by time_created").all() as Array<Record<string, unknown>>) {
        const id = String(session.id)
        if (has("session_v2", id)) {
          counts.skipped++
          continue
        }
        if (!projectIDs.has(String(session.project_id))) {
          ensureGlobal()
          session.project_id = "global"
        }
        insert("session_v2", targetSession, { ...session, permission: null })
        const row = target.query("select * from session_v2 where id = ?").get(id) as never
        const messages = source.query("select id, session_id, time_created, time_updated, data from message where session_id = ?").all(id) as V1Migration.SourceMessage[]
        const parts = source.query("select id, message_id, session_id, time_created, time_updated, data from part where session_id = ?").all(id) as V1Migration.SourcePart[]
        const transformed = V1Migration.transformSession({ session: row, messages, parts })
        counts.warnings += transformed.warnings.length
        for (const message of transformed.messages) {
          target.query("insert or ignore into session_message (id, session_id, type, seq, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?, ?)").run(
            message.id, message.session_id, message.type, message.seq, message.time_created, message.time_updated, JSON.stringify(message.data),
          )
        }
        const fields = Object.entries(transformed.session).filter(([key, value]) => value !== undefined && targetSession.includes(key))
        if (fields.length)
          target.query(`update session_v2 set ${fields.map(([key]) => `${key} = ?`).join(", ")} where id = ?`).run(
            ...(fields.map(([, value]) => (typeof value === "object" && value !== null ? JSON.stringify(value) : value)) as never[]),
            id,
          )
        sequence(id, transformed.watermark)
        counts.v1++
        counts.messages += transformed.messages.length
      }
    }
    target.run("commit")
  } catch (error) {
    target.run("rollback")
    throw error
  }
  source.close()
}
console.log(JSON.stringify(report, null, 1))
console.log("sessions now:", (target.query("select count(*) n from session_v2").get() as { n: number }).n)
target.close()
