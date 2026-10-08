import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { KV } from "@opencode/core/kv"
import { LayerNode } from "@opencode/util/effect/layer-node"
import {
  clearResumeToken,
  formatResumeNote,
  loadResumeToken,
  writeResumeToken,
} from "../src/session/runner/resume-token.js"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(KV.node))

describe("resume-token", () => {
  it.effect("round-trips a token and formats a resume note", () =>
    Effect.gen(function* () {
      const token = {
        sessionID: "ses_resume_token",
        step: 7,
        updatedAt: Date.now(),
        checklist: [
          { id: "a", title: "fix retry", done: true },
          { id: "b", title: "wire rotation", done: false },
        ],
        completedFiles: ["packages/core/src/session/runner/retry.ts"],
        nextAction: "wire rotation into llm drain",
      }
      yield* writeResumeToken(token)
      const loaded = yield* loadResumeToken("ses_resume_token")
      expect(loaded?.step).toBe(7)
      expect(loaded?.nextAction).toContain("wire rotation")
      expect(formatResumeNote(loaded!)).toContain("Resume from step 7")
      yield* clearResumeToken("ses_resume_token")
      expect(yield* loadResumeToken("ses_resume_token")).toBeUndefined()
    }),
  )

  it.effect("returns undefined for missing or corrupt rows", () =>
    Effect.gen(function* () {
      expect(yield* loadResumeToken("ses_resume_missing")).toBeUndefined()
      const kv = yield* KV.Service
      yield* kv.set("resume-token/ses_resume_bad", { nope: true })
      expect(yield* loadResumeToken("ses_resume_bad")).toBeUndefined()
      yield* kv.remove("resume-token/ses_resume_bad")
    }),
  )
})
