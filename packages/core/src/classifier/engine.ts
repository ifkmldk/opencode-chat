import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Config } from "../config.js"
import { Permission } from "../permission.js"

export const State = Schema.Json
export const Question = Schema.Struct({
  type: Schema.Literals(["choice", "score", "noul"] as const),
  instructions: Schema.String.check(Schema.isMaxLength(2_000)),
  criteria: Schema.optional(Schema.Json),
})
export const Input = Schema.Struct({
  state: State,
  questions: Schema.Record(Schema.String, Question),
  // fork: the user's own question, so the answer stays tied to what was asked.
  question: Schema.optional(Schema.String),
})
export const Answer = Schema.Struct({
  type: Schema.String,
  decision: Schema.String,
  confidence: Schema.optional(Schema.Number),
  rationale: Schema.optional(Schema.String),
})
export const Output = Schema.Struct({
  engine: Schema.Literals(["laya-mlx", "classifier-native", "deterministic-fallback"]),
  available: Schema.Boolean,
  model: Schema.optional(Schema.String),
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }),
  warnings: Schema.Array(Schema.String),
})

export const nativeSupported = process.platform === "darwin" && process.arch === "arm64"
export const python = process.env.OPENCODE_CLASSIFIER_PYTHON ?? process.env.OPENCODE_LAYA_PYTHON ?? "python3"

const modelDefault = "aac6fef/laya-mlx"
const script = String.raw`import json, os
try:
 import laya_mlx as clf
except Exception:
 print(json.dumps({"available": False, "reason": "classifier runtime is not installed"})); raise SystemExit(0)
payload=json.loads(os.environ["CLASSIFIER_PAYLOAD"]); agent=clf.load(os.environ.get("CLASSIFIER_MODEL", "aac6fef/laya-mlx")); print(json.dumps({"available": True, "model": os.environ.get("CLASSIFIER_MODEL", "aac6fef/laya-mlx"), "result": agent.predict(payload["state"], payload["questions"])}))`

export const fallback = (input: typeof Input.Type) => {
  const state = typeof input.state === "string" ? input.state : JSON.stringify(input.state)
  const answers: Record<string, { type: string; decision: string; confidence: number; rationale: string }> = {}
  const ranking = stateRanking(input.state)
  for (const [key, question] of Object.entries(input.questions) as [string, typeof Question.Type][]) {
    const criteria: string[] = Array.isArray(question.criteria)
      ? question.criteria.filter((item: unknown): item is string => typeof item === "string")
      : []
    const spatial = rankedChoice(ranking, criteria)
    if (spatial) {
      answers[key] = { type: question.type, ...spatial }
      continue
    }
    const lower = state.toLowerCase()
    const ranked = criteria
      .map((criterion: string) => ({ criterion, score: lower.includes(criterion.toLowerCase()) ? 1 : 0 }))
      .sort((a: { criterion: string; score: number }, b: { criterion: string; score: number }) => b.score - a.score)
    answers[key] =
      ranked.length > 0 && ranked[0]!.score > 0
        ? {
            type: question.type,
            decision: ranked[0]!.criterion,
            confidence: 0.75,
            rationale: `Keyword overlap with the supplied state selected "${ranked[0]!.criterion}". Deterministic mode.`,
          }
        : {
            type: question.type,
            decision: "No confident choice",
            confidence: 0,
            rationale: criteria.length
              ? "No criterion matched the supplied state, so no confident choice was made. Deterministic mode."
              : "No criteria were supplied, so no confident choice was made. Deterministic mode.",
          }
  }
  return {
    engine: "deterministic-fallback" as const,
    available: false,
    answers,
    usage: { input_tokens: 0, output_tokens: 0 },
    warnings: [
      "Classifier is running in deterministic mode on this host: it ranks by the supplied scores and keyword overlap, it is not a model. Treat its choice as a hint, check the candidate facts yourself, and never call a result guaranteed or verified because of it.",
      ...(input.question ? [`Question this answers: ${input.question.slice(0, 300)}`] : []),
    ],
  }
}

// fork: ranking-aware deterministic choice shared by classifier_classify.
const RankingEntry = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  score: Schema.Number,
})
const decodeRanking = Schema.decodeUnknownOption(Schema.Struct({ ranking: Schema.Array(RankingEntry) }))

export function stateRanking(state: unknown) {
  const direct = decodeRanking(state)
  if (direct._tag === "Some") return direct.value.ranking
  const nested =
    typeof state === "object" && state !== null
      ? Object.values(state)
          .map((value) => decodeRanking(value))
          .find((value) => value._tag === "Some")
      : undefined
  return nested?._tag === "Some" ? nested.value.ranking : undefined
}

export function rankedChoice(
  ranking: ReturnType<typeof stateRanking>,
  criteria: readonly string[],
  geoScores?: Record<string, number>,
) {
  if (!ranking?.length) return
  const matches = (entry: (typeof ranking)[number], criterion: string) =>
    [entry.name, entry.id].some((label) => label?.toLowerCase() === criterion.toLowerCase())
  // fork: research_deep geo blend — bila orchestrate menyertakan skor geo (jarak/waktu
  // dinormalisasi 0..1 per kandidat id/name), gabung 0.6*rank + 0.4*geo agar yang dekat
  // menang. Tanpa geoScores perilaku lama dipertahankan (backward-compat).
  const scored = ranking
    .filter((entry) => !criteria.length || criteria.some((criterion) => matches(entry, criterion)))
    .map((entry) => {
      const key = entry.name ?? entry.id ?? ""
      const geo = geoScores?.[key] ?? geoScores?.[key.toLowerCase()] ?? undefined
      const blended = typeof geo === "number" && Number.isFinite(geo) ? entry.score * 0.6 + Math.max(0, Math.min(1, geo)) * 0.4 : entry.score
      return { entry, blended }
    })
    .toSorted((a, b) => b.blended - a.blended)
    .map(({ entry }) => entry)
  const best = scored[0]
  if (!best) return
  const decision = criteria.find((criterion) => matches(best, criterion)) ?? best.name ?? best.id ?? "No confident choice"
  const margin = best.score - (scored[1]?.score ?? 0)
  const geoNote = geoScores ? " Geo-blended (0.6 rank + 0.4 proximity)." : ""
  return {
    decision,
    confidence: Math.min(1, 0.5 + margin),
    rationale: `Top score ${best.score.toFixed(3)} in the supplied ranking (margin ${margin.toFixed(3)} over runner-up). Deterministic mode.${geoNote}`,
  }
}

export const readResult = (value: unknown, input: typeof Input.Type) => {
  if (!value || typeof value !== "object" || !(value as { available?: unknown }).available) return fallback(input)
  const raw = (value as { result?: { answers?: Record<string, unknown>; usage?: { input_tokens?: unknown; output_tokens?: unknown } } }).result
  const answers: Record<string, { type: string; decision: string; confidence: number; rationale: string }> = {}
  for (const [key, answer] of Object.entries((raw?.answers ?? {}) as Record<string, unknown>)) {
    if (typeof answer === "string") {
      answers[key] = { type: "choice", decision: answer, confidence: 0.5, rationale: "Classifier decision." }
    } else {
      const record = answer as { decision?: unknown; confidence?: unknown; rationale?: unknown }
      answers[key] = {
        type: "choice",
        decision: String(record.decision ?? "No confident choice"),
        confidence: Number(record.confidence ?? 0.5),
        rationale: String(record.rationale ?? "Classifier decision."),
      }
    }
  }
  return {
    engine: "classifier-native" as const,
    available: true,
    model: String((value as { model?: unknown }).model ?? modelDefault),
    answers,
    usage: {
      input_tokens: Number(raw?.usage?.input_tokens ?? 0),
      output_tokens: Number(raw?.usage?.output_tokens ?? 0),
    },
    warnings: [] as string[],
  }
}

export const runNative = (input: typeof Input.Type, modelDir: string | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([python, "-c", script], {
        env: {
          ...process.env,
          CLASSIFIER_PAYLOAD: JSON.stringify({ state: input.state, questions: input.questions }),
          LAYA_PAYLOAD: JSON.stringify({ state: input.state, questions: input.questions }),
          CLASSIFIER_MODEL: modelDir ?? process.env.OPENCODE_CLASSIFIER_MODEL ?? process.env.OPENCODE_LAYA_MODEL ?? modelDefault,
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await new Response(proc.stdout).text()
      const code = await proc.exited
      if (code !== 0)
        throw new Error((await new Response(proc.stderr).text()).slice(0, 2000) || `Classifier exited with code ${code}`)
      return JSON.parse(text)
    },
    catch: (error) => error,
  }).pipe(
    Effect.mapError(
      (error) => new ToolFailure({ message: `Classifier runtime failed: ${error instanceof Error ? error.message : String(error)}`, error }),
    ),
  )

export const Plugin = {
  id: "opencode.tool.classifier",
  effect: Effect.fn("ClassifierTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const run = (input: typeof Input.Type, context: Tool.Context, action: string) =>
      Effect.gen(function* () {
        yield* permission
          .assert({
            action,
            resources: ["system-one"],
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.messageID, id: context.id },
          })
          .pipe(Effect.mapError((error) => new ToolFailure({ message: `Classifier permission denied: ${error.message}`, error })))
        const experimental = Config.latest(yield* config.entries(), "experimental") as
          | { classifier?: { enabled?: boolean; modelDir?: string }; laya?: { enabled?: boolean; modelDir?: string } }
          | undefined
        const classifier = experimental?.classifier ?? experimental?.laya
        if (classifier?.enabled === false) return yield* new ToolFailure({ message: "Classifier is disabled." })
        if (!nativeSupported) {
          const output = fallback(input)
          return { output, content: JSON.stringify(output), metadata: { engine: output.engine, available: false } }
        }
        const result = yield* runNative(input, classifier?.modelDir)
        const output = readResult(result, input)
        return { output, content: JSON.stringify(output), metadata: { engine: output.engine, available: output.available } }
      })
    const register = (name: string, action: string) =>
      ctx.tool.transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: action },
          description:
            "Classify structured research state with the built-in classifier. Returns typed choices, confidence, and rationale; it never generates prose or performs side effects. Uses an explicitly labelled deterministic fallback when native inference is unavailable.",
          input: Input,
          output: Output,
          execute: (input, context) => run(input, context, action),
        }),
      )
    yield* register("classifier_classify", "classifier.classify")
    yield* register("laya_classify", "laya.classify")
  }),
}

export const ClassifierTool = Plugin
export const ClassifierPlugin = Plugin
export const LayaAlias = ClassifierTool

export const __test = { Input, Output, nativeSupported, fallback, stateRanking, rankedChoice, readResult }


