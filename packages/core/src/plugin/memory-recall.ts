export * as MemoryRecallPlugin from "./memory-recall.js"

import { Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { MemoryRank } from "../memory/rank.js"
import { MemoryStore } from "../memory/store.js"
import { MemoryVaultFiles } from "../memory/vault.js"

// fork: memory recall that follows the question. For every agent-loop request the user's latest message is ranked against the
// saved notes (database and Obsidian vault) and the few that clearly fit are placed right before that message. Nothing is
// stored in the conversation, the cached prompt prefix is untouched, and nothing is added when no note fits: a wrong note
// pulls an answer out of context, so silence is the default. (The old system-prompt recall was called with an empty query
// and never ran.)

const textOf = (message: Message) =>
  message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    // ignore reminders and attachments injected by the app around the real text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim()

export const Plugin = define({
  id: "opencode.memory-recall",
  effect: Effect.fn("MemoryRecallPlugin")(function* (ctx) {
    const memory = yield* MemoryStore.Service
    const global = yield* Global.Service
    yield* ctx.session.hook("context", (event) => {
      const index = event.messages.findLastIndex((message) => message.role === "user")
      const last = event.messages[index]
      if (!last) return Effect.void
      const query = textOf(last)
      if (query.length < 8) return Effect.void
      return Effect.gen(function* () {
        const vault = MemoryVaultFiles.settings(global.config)
        const pool = [...(yield* memory.list()), ...(vault.dir ? MemoryVaultFiles.read(vault.dir) : [])]
        const note = MemoryRank.block(MemoryRank.rank(query, pool, { limit: 5, minScore: 4 }))
        if (note) event.messages.splice(index, 0, Message.user(note))
      }).pipe(Effect.catchCause(() => Effect.void))
    })
  }),
})
