export * as MemoryInstructions from "./instruction-source.js"

import { Effect, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Layer } from "effect"
import { Location } from "../location.js"
import { Instructions } from "../instructions/index.js"
import { MemoryRecall } from "./recall.js"
import { MemoryStore } from "./store.js"
import { SessionSchema } from "../session/schema.js"

const key = Instructions.Key.make("core/memory")

export interface Interface {
  readonly forPrompt: (sessionID: SessionSchema.ID, userText: string) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Location.Service
    const memory = yield* MemoryStore.Service
    return Service.of({
      forPrompt: Effect.fn("MemoryInstructions.forPrompt")(function* (sessionID: SessionSchema.ID, userText: string) {
        void sessionID
        if (!userText.trim()) return Instructions.empty
        const [global, scoped] = yield* Effect.all(
          [memory.search(userText, "global", 4), memory.search(userText, undefined, 8)],
          { concurrency: 2 },
        )
        const seen = new Set<string>()
        const merged = [...global, ...scoped].filter((entry) => {
          if (seen.has(entry.id)) return false
          seen.add(entry.id)
          return true
        })
        const block = MemoryRecall.buildMemoryBlock(merged.slice(0, 8))
        if (!block) return Instructions.empty
        return Instructions.make({
          key,
          codec: Schema.toCodecJson(Schema.String),
          read: Effect.succeed(block),
          render: {
            initial: (text) => text,
            changed: (_previous, text) => text,
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, MemoryStore.node] })
