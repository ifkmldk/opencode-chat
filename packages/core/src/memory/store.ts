export * as MemoryStore from "./store.js"

import { and, desc, eq, like, or } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { createHash, randomUUID } from "crypto"
import { Database } from "../database/database.js"
import { MemoryTable } from "../kv/sql.js"

export const Scope = Schema.Literals(["global", "project", "session"])
export type Scope = typeof Scope.Type

export const Kind = Schema.Literals(["fact", "preference", "decision", "correction", "person", "project-brief"])
export type Kind = typeof Kind.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  scope: Scope,
  kind: Kind,
  title: Schema.String.check(Schema.isMaxLength(120)),
  body: Schema.String.check(Schema.isMaxLength(2000)),
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  source: Schema.Literals(["user", "agent", "import"]),
})
export type Entry = typeof Entry.Type

export const hashBody = (body: string) => createHash("sha256").update(body).digest("hex")

const toEntry = (row: typeof MemoryTable.$inferSelect): Entry => ({
  id: row.id,
  scope: row.scope as Scope,
  kind: row.kind as Kind,
  title: row.title,
  body: row.body,
  ...(row.project_id ? { projectID: row.project_id } : {}),
  ...(row.session_id ? { sessionID: row.session_id } : {}),
  source: (row.source === "user" || row.source === "import" ? row.source : "agent") as Entry["source"],
})

export interface SaveInput {
  readonly scope: Scope
  readonly kind: Kind
  readonly title: string
  readonly body: string
  readonly projectID?: string
  readonly sessionID?: string
  readonly source?: Entry["source"]
}

export interface Interface {
  readonly save: (input: SaveInput) => Effect.Effect<Entry>
  readonly search: (query: string, scope?: Scope, limit?: number) => Effect.Effect<Entry[]>
  readonly forget: (id: string) => Effect.Effect<boolean>
  readonly list: (scope?: Scope) => Effect.Effect<Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return Service.of({
      save: Effect.fn("Memory.save")(function* (input: SaveInput) {
        const entry: Entry = {
          id: randomUUID(),
          scope: input.scope,
          kind: input.kind,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 2000),
          ...(input.projectID ? { projectID: input.projectID } : {}),
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
          source: input.source ?? "agent",
        }
        const now = Date.now()
        yield* db
          .insert(MemoryTable)
          .values({
            id: entry.id,
            scope: entry.scope,
            kind: entry.kind,
            title: entry.title,
            body: entry.body,
            project_id: entry.projectID,
            session_id: entry.sessionID,
            source: entry.source,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return entry
      }),
      search: Effect.fn("Memory.search")(function* (query: string, scope?: Scope, limit?: number) {
        const capped = Math.min(Math.max(Math.floor(limit ?? 8), 1), 20)
        const pattern = `%${query.slice(0, 500).replace(/[%_]/g, "")}%`
        const rows = yield* db
          .select()
          .from(MemoryTable)
          .where(and(scope ? eq(MemoryTable.scope, scope) : undefined, or(like(MemoryTable.title, pattern), like(MemoryTable.body, pattern))))
          .orderBy(desc(MemoryTable.time_updated))
          .limit(capped)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toEntry)
      }),
      forget: Effect.fn("Memory.forget")(function* (id: string) {
        // fork: report whether a row existed (it used to answer true for any id).
        const existing = yield* db.select().from(MemoryTable).where(eq(MemoryTable.id, id)).limit(1).all().pipe(Effect.orDie)
        if (existing.length === 0) return false
        yield* db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run().pipe(Effect.orDie)
        return true
      }),
      list: Effect.fn("Memory.list")(function* (scope?: Scope) {
        const rows = yield* db
          .select()
          .from(MemoryTable)
          .where(scope ? eq(MemoryTable.scope, scope) : undefined)
          .orderBy(desc(MemoryTable.time_updated))
          .limit(100)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toEntry)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
