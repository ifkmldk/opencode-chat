export * as ActionTool from "./action.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Option, Schema } from "effect"
import { Form } from "../../form.js"
import { KV } from "../../kv.js"
import { Permission } from "../../permission.js"

const Kinds = ["booking", "purchase", "application", "form", "map", "job"] as const
const Statuses = ["pending", "approved", "rejected", "cancelled", "completed", "failed"] as const
const StoredAction = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  kind: Schema.Literals(Kinds),
  summary: Schema.String,
  payload: Schema.Json,
  status: Schema.Literals(Statuses),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  result: Schema.optional(Schema.Json),
  error: Schema.optional(Schema.String),
})
type StoredAction = typeof StoredAction.Type
type Json = typeof Schema.Json.Type
const Input = Schema.Struct({
  operation: Schema.Literals(["prepare", "status", "cancel"] as const),
  actionID: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(Kinds)),
  summary: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Json),
})
const Output = Schema.Struct({ action: StoredAction })
const prefix = "action:v1:"
const load = (kv: KV.Interface, id: string) => Effect.gen(function* () {
  const value = yield* kv.get(prefix + id)
  if (value === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(StoredAction)(value)
  return Option.isNone(decoded) ? undefined : decoded.value
})
const text = (value: unknown) => JSON.stringify(value).slice(0, 4000)
const actionWebhook = () => {
  const value = process.env.OPENCODE_ACTION_WEBHOOK
  if (!value) return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("OPENCODE_ACTION_WEBHOOK must be a valid URL")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("OPENCODE_ACTION_WEBHOOK must use http or https")
  if (url.username || url.password) throw new Error("OPENCODE_ACTION_WEBHOOK must not contain credentials")
  return url
}
export const __test = { actionWebhook }

export const Plugin = {
  id: "opencode.tool.action",
  effect: Effect.fn("ActionTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const kv = yield* KV.Service
    const save = (action: StoredAction) => kv.set(prefix + action.id, Schema.encodeUnknownSync(StoredAction)(action))
    const finish = (action: StoredAction, status: StoredAction["status"], result?: Json, error?: string) =>
      Effect.gen(function* () {
        const next = { ...action, status, result, error, updatedAt: Date.now() }
        yield* save(next)
        return next
      })

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "action",
        options: { codemode: false, permission: "action" },
        description: "Prepare, inspect, or cancel a durable external action. High-impact actions require explicit approval and a configured executor.",
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            if (input.operation === "status" || input.operation === "cancel") {
              if (!input.actionID) return yield* new ToolFailure({ message: "actionID is required for status or cancel" })
              const decoded = yield* load(kv, input.actionID)
              if (!decoded) return yield* new ToolFailure({ message: `Action not found: ${input.actionID}` })
              const action = decoded
              if (input.operation === "status") return { output: { action }, content: text(action) }
              if (action.status === "completed") return yield* new ToolFailure({ message: "Completed actions cannot be cancelled" })
              const cancelled = yield* finish(action, "cancelled")
              return { output: { action: cancelled }, content: "Action cancelled." }
            }
            if (!input.kind || !input.summary) return yield* new ToolFailure({ message: "kind and summary are required" })
            const now = Date.now()
            const action: StoredAction = { id: crypto.randomUUID(), sessionID: context.sessionID, kind: input.kind, summary: input.summary.slice(0, 500), payload: input.payload ?? {}, status: "pending", createdAt: now, updatedAt: now }
            yield* save(action)
            yield* permission.assert({ action: `action.${input.kind}`, resources: [action.id], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id }, metadata: { actionID: action.id, kind: input.kind, summary: action.summary } }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Action permission denied: ${error.message}`, error })))
            const response = yield* forms.ask({ sessionID: context.sessionID, title: "Approve external action", metadata: { kind: "action.approval", actionID: action.id, actionKind: input.kind }, fields: [{ key: "decision", title: "Review action", description: `${action.summary}\n\nThis action will not execute until approved.`, type: "string", options: [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }], custom: true }] }).pipe(Effect.orDie)
            if (response.status === "cancelled" || response.answer.decision === "reject") return { output: { action: yield* finish(action, "rejected") }, content: "The user rejected the action." }
            const approved = yield* finish(action, "approved")
            const webhook = yield* Effect.try({ try: actionWebhook, catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }) })
            if (!webhook) return { output: { action: approved }, content: "Action approved, but no executor is configured. Set OPENCODE_ACTION_WEBHOOK to enable execution." }
            const result = yield* Effect.tryPromise({ try: () => fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approved), signal: AbortSignal.timeout(30_000) }).then(async (response) => { const body = await response.text(); if (!response.ok) throw new Error(`executor returned HTTP ${response.status}`); return body }), catch: (error) => error }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Action executor failed: ${error instanceof Error ? error.message : String(error)}`, error })))
            const completed = yield* finish(approved, "completed", result)
            return { output: { action: completed }, content: `Action completed: ${completed.summary}` }
          }),
      }),
    ).pipe(Effect.orDie)
  }),
}

