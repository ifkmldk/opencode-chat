import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql.js"
import type { KV } from "../kv.js"

export const KVTable = sqliteTable("kv", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).$type<KV.Value>().notNull(),
  ...Timestamps,
})

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    project_id: text(),
    session_id: text(),
    source: text().notNull().default("agent"),
    ...Timestamps,
  },
  (table) => [index("memory_scope_updated_idx").on(table.scope, table.time_updated)],
)

