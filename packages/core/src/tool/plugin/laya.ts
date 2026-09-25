export * as LayaTool from "./laya.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { Permission } from "../../permission.js"

const State = Schema.Json
const Question = Schema.Struct({ type: Schema.Literals(["choice", "score", "noul"] as const), instructions: Schema.String.check(Schema.isMaxLength(2_000)), criteria: Schema.optional(Schema.Json) })
const Input = Schema.Struct({ state: State, questions: Schema.Record(Schema.String, Question) })
const Answer = Schema.Struct({ type: Schema.String, decision: Schema.String, confidence: Schema.optional(Schema.Number), rationale: Schema.optional(Schema.String) })
const Output = Schema.Struct({ engine: Schema.Literals(["laya-mlx", "deterministic-fallback"]), available: Schema.Boolean, model: Schema.optional(Schema.String), answers: Schema.Record(Schema.String, Answer), usage: Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }), warnings: Schema.Array(Schema.String) })
const nativeSupported = process.platform === "darwin" && process.arch === "arm64"
const python = process.env.OPENCODE_LAYA_PYTHON ?? "python3"
const script = String.raw`import json, os
try:
 import laya_mlx as laya
except Exception:
 print(json.dumps({"available": False, "reason": "laya-mlx is not installed"})); raise SystemExit(0)
payload=json.loads(os.environ["LAYA_PAYLOAD"]); agent=laya.load(os.environ.get("LAYA_MODEL", "aac6fef/laya-mlx")); print(json.dumps({"available": True, "model": os.environ.get("LAYA_MODEL", "aac6fef/laya-mlx"), "result": agent.predict(payload["state"], payload["questions"])}))`
const fallback = (input: typeof Input.Type) => {
  const state = typeof input.state === "string" ? input.state : JSON.stringify(input.state)
  const answers: Record<string, { type: string; decision: string; confidence: number; rationale: string }> = {}
  for (const [key, question] of Object.entries(input.questions) as [string, typeof Question.Type][]) {
    const criteria: string[] = Array.isArray(question.criteria) ? question.criteria.filter((item: unknown): item is string => typeof item === "string") : []
    const lower = state.toLowerCase(); const ranked = criteria.map((criterion: string) => ({ criterion, score: lower.includes(criterion.toLowerCase()) ? 1 : 0 })).sort((a: { criterion: string; score: number }, b: { criterion: string; score: number }) => b.score - a.score)
    answers[key] = { type: question.type, decision: ranked[0]?.criterion ?? "noul", confidence: criteria.length ? ranked[0]?.score ?? 0 : 0.5, rationale: "Explicit deterministic fallback; native Laya-MLX is unavailable on this host." }
  }
  return { engine: "deterministic-fallback" as const, available: false, answers, usage: { input_tokens: 0, output_tokens: 0 }, warnings: ["Laya-MLX requires macOS 14+ on Apple Silicon. Configure OPENCODE_LAYA_PYTHON on a Mac to use native inference."] }
}
const readResult = (value: unknown, input: typeof Input.Type) => {
  if (!value || typeof value !== "object" || !(value as any).available) return fallback(input)
  const raw = (value as any).result; const answers: Record<string, { type: string; decision: string; confidence: number; rationale: string }> = {}
  for (const [key, answer] of Object.entries((raw?.answers ?? {}) as Record<string, any>)) answers[key] = typeof answer === "string" ? { type: "choice", decision: answer, confidence: 0.5, rationale: "Laya typed decision." } : { type: "choice", decision: String(answer.decision ?? "noul"), confidence: Number(answer.confidence ?? 0.5), rationale: String(answer.rationale ?? "") }
  return { engine: "laya-mlx" as const, available: true, model: String((value as any).model ?? "aac6fef/laya-mlx"), answers, usage: { input_tokens: Number(raw?.usage?.input_tokens ?? 0), output_tokens: Number(raw?.usage?.output_tokens ?? 0) }, warnings: [] }
}
export const Plugin = { id: "opencode.tool.laya", effect: Effect.fn("LayaTool.Plugin")(function* (ctx: Context) {
  const config = yield* Config.Service; const permission = yield* Permission.Service
  yield* ctx.tool.transform((editor) => editor.add({ name: "laya_classify", options: { codemode: false, permission: "laya.classify" }, description: "Classify structured research state with Laya-MLX. Returns typed choices, confidence, and rationale; it never generates prose or performs side effects. Non-Apple-Silicon hosts use an explicitly labelled deterministic fallback.", input: Input, output: Output, execute: (input, context) => Effect.gen(function* () {
    yield* permission.assert({ action: "laya.classify", resources: ["system-one"], sessionID: context.sessionID, agent: context.agent, source: { type: "tool", messageID: context.messageID, id: context.id } }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Laya permission denied: ${error.message}`, error })))
    const experimental = Config.latest(yield* config.entries(), "experimental"); if (experimental?.laya?.enabled === false) return yield* new ToolFailure({ message: "Laya classifier is disabled." })
    if (!nativeSupported) { const output = fallback(input); return { output, content: JSON.stringify(output), metadata: { engine: output.engine, available: false } } }
    const result = yield* Effect.tryPromise({ try: async () => { const proc = Bun.spawn([python, "-c", script], { env: { ...process.env, LAYA_PAYLOAD: JSON.stringify({ state: input.state, questions: input.questions }), LAYA_MODEL: experimental?.laya?.modelDir ?? process.env.OPENCODE_LAYA_MODEL ?? "aac6fef/laya-mlx" }, stdout: "pipe", stderr: "pipe" }); const text = await new Response(proc.stdout).text(); const code = await proc.exited; if (code !== 0) throw new Error(await new Response(proc.stderr).text()); return JSON.parse(text) }, catch: (error) => error }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Laya runtime failed: ${error instanceof Error ? error.message : String(error)}`, error })))
    const output = readResult(result, input); return { output, content: JSON.stringify(output), metadata: { engine: output.engine, available: output.available } }
  }) })).pipe(Effect.orDie)
}) }
export const __test = { Input, Output, nativeSupported, fallback }


