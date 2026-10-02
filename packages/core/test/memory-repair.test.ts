import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { sql } from "drizzle-orm"
import { DatabaseMigration } from "@opencode/core/database/migration"
import memoryRepair from "@opencode/core/database/migration/20261002082455_icy_meggan"
import { MemoryTable } from "@opencode/core/kv/sql"
import { Global } from "@opencode/util/global"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient | Global.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(Global.Service, Global.make({ data: path.join(process.cwd(), ".test-data") })),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

describe("memory table repair", () => {
  test("creates the memory table idempotently", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.applyOnly(db, [memoryRepair])
        yield* DatabaseMigration.applyOnly(db, [memoryRepair])
        yield* db
          .insert(MemoryTable)
          .values({
            id: "repair-test",
            scope: "global",
            kind: "fact",
            title: "repair",
            body: "repair row",
            source: "agent",
            time_created: 1,
            time_updated: 1,
          })
          .run()
        expect(yield* db.get(sql`SELECT COUNT(*) AS count FROM memory`)).toEqual({ count: 1 })
        yield* db.run(sql`DELETE FROM memory WHERE id = 'repair-test'`)
        expect(yield* db.get(sql`SELECT COUNT(*) AS count FROM memory`)).toEqual({ count: 0 })
      }),
    )
  })

  test("migration registry includes the repair id", async () => {
    const { migrations } = await import("@opencode/core/database/migration.gen")
    expect(migrations.map((m) => m.id)).toContain("20261002082455_icy_meggan")
    expect(migrations.map((m) => m.id)).toContain("20261001000000_memory_table")
  })
})
