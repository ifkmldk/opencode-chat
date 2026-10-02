export * as MemoryRecall from "./recall.js"

import { Effect } from "effect"
import { MemoryStore } from "./store.js"
import { SessionSchema } from "../session/schema.js"

// fork: recall block injected into the system prompt. Empty vault = empty string (zero behavior change).
const MAX_BYTES = 4096
const MAX_ENTRIES = 8

export const buildMemoryBlock = (entries: ReadonlyArray<MemoryStore.Entry>) => {
  if (entries.length === 0) return ""
  const lines = ["## Remembered context (vault)"]
  let bytes = lines[0]!.length
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const line = `- [${entry.kind}] ${entry.title}: ${entry.body.slice(0, 280)} (memory:${entry.id.slice(0, 8)})`
    if (bytes + line.length + 1 > MAX_BYTES) break
    lines.push(line)
    bytes += line.length + 1
  }
  if (lines.length === 1) return ""
  return lines.join("\n")
}

export const recall = (sessionID: SessionSchema.ID, userText: string) =>
  Effect.gen(function* () {
    const memory = yield* MemoryStore.Service
    if (!userText.trim()) return ""
    const [global, scoped] = yield* Effect.all(
      [memory.search(userText, "global", 4), memory.search(userText, undefined, 8)],
      { concurrency: 2 },
    )
    const seen = new Set<string>()
    const merged = [...global, ...scoped].filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      void sessionID
      return true
    })
    return buildMemoryBlock(merged.slice(0, MAX_ENTRIES))
  }).pipe(Effect.orElseSucceed(() => ""))
