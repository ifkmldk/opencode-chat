export * as MemoryTool from "./memory.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { MemoryStore } from "../../memory/store.js"
import { MemoryRank } from "../../memory/rank.js"
import { MemoryVaultFiles } from "../../memory/vault.js"
import { Global } from "@opencode/util/global"

const Save = Schema.Struct({
  scope: MemoryStore.Scope,
  kind: MemoryStore.Kind,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  body: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})
const Search = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  scope: Schema.optional(MemoryStore.Scope),
  limit: Schema.optional(Schema.Number),
})
const Forget = Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) })
const EntryOut = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  body: Schema.String,
})

const guard = (permission: Permission.Interface, action: string, resources: string[], c: Tool.Context) =>
  permission
    .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
    .pipe(Effect.mapError((error) => new ToolFailure({ message: `Memory permission denied: ${error.message}`, error })))

export const Plugin = {
  id: "opencode.tool.memory",
  effect: Effect.fn("MemoryTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const memory = yield* MemoryStore.Service
    const global = yield* Global.Service
    const vault = () => MemoryVaultFiles.settings(global.config)
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "memory_save",
        options: { codemode: false, permission: "memory.save" },
        description: "Save a durable fact, preference, decision, or correction to the vault-backed memory. Ask the user before saving unless they asked to remember.",
        input: Save,
        output: EntryOut,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "memory.save", [input.scope], c)
            const entry = yield* memory.save({ scope: input.scope, kind: input.kind, title: input.title, body: input.body, ...(input.projectID ? { projectID: input.projectID } : {}), ...(input.sessionID ? { sessionID: input.sessionID } : {}) })
            // fork: the Obsidian vault is the shared copy; write the note there too (memory.json: { "write": false } turns it off).
            const target = vault()
            const written = target.dir && target.write ? yield* Effect.try(() => MemoryVaultFiles.write(target.dir!, { id: entry.id, kind: entry.kind, scope: entry.scope, title: entry.title, body: entry.body, updated: Date.now(), source: entry.source })).pipe(Effect.option) : undefined
            const output = { id: entry.id, scope: entry.scope, kind: entry.kind, title: entry.title, body: entry.body }
            return { output, content: `Saved [${entry.kind}] ${entry.title}${written && written._tag === "Some" ? " (also written to the Obsidian vault)" : ""}`, metadata: { id: entry.id } }
          }),
      }),
    )
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "memory_search",
        options: { codemode: false, permission: "memory.search" },
        description: "Search vault-backed memory for facts, preferences, decisions, and corrections.",
        input: Search,
        output: Schema.Struct({ items: Schema.Array(EntryOut) }),
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "memory.search", [input.query.slice(0, 120)], c)
            // fork: ranked recall over the database and the Obsidian vault (word-based, stricter than the old whole-sentence LIKE).
            const target = vault()
            const pool = [
              ...(yield* memory.list(input.scope)),
              ...(target.dir ? MemoryVaultFiles.read(target.dir).filter((entry) => !input.scope || entry.scope === input.scope) : []),
            ]
            const found = MemoryRank.rank(input.query, pool, { limit: Math.min(Math.max(Math.floor(input.limit ?? 8), 1), 20), minScore: 2 })
            const items = found.map((entry) => ({ id: entry.id, scope: entry.scope, kind: entry.kind, title: entry.title, body: entry.body }))
            return { output: { items }, content: JSON.stringify(items), metadata: { count: items.length } }
          }),
      }),
    )
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "memory_forget",
        options: { codemode: false, permission: "memory.forget" },
        description: "Delete one memory entry by id.",
        input: Forget,
        output: Schema.Struct({ removed: Schema.Boolean }),
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "memory.forget", [input.id], c)
            const target = vault()
            const fromVault = target.dir && target.write ? MemoryVaultFiles.remove(target.dir, input.id) : false
            const removed = (yield* memory.forget(input.id)) || fromVault
            return { output: { removed }, content: removed ? "Forgot that memory." : "Nothing to forget.", metadata: {} }
          }),
      }),
    )
  }),
}
