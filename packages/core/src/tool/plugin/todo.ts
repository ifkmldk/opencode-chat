export * as TodoTool from "./todo.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

// fork: a visible checklist for multi-step work (Claude Code's TodoWrite, Codex's plan). The model rewrites the full
// list on every call; the call itself is the state, so nothing is stored here and the timeline renders each call as a
// compact progress card. Keeping it a plain tool means it works in every mode and survives compaction like any
// other tool result.

const Status = Schema.Literals(["pending", "in_progress", "completed"])

const Item = Schema.Struct({
  content: Schema.String.annotate({ description: "What to do, as an imperative: \"Write the summary slide\"." }),
  status: Status,
  activeForm: Schema.optional(Schema.String).annotate({
    description: "Present-tense form shown while the item is in progress: \"Writing the summary slide\".",
  }),
})

const Input = Schema.Struct({
  todos: Schema.Array(Item).annotate({ description: "The complete, current list. Replaces the previous list." }),
})

const Output = Schema.Struct({
  todos: Schema.Array(Item),
  total: Schema.Number,
  completed: Schema.Number,
  active: Schema.optional(Schema.String),
})

export const Plugin = {
  id: "opencode.tool.todo",
  effect: Effect.fn("TodoTool.Plugin")(function* (ctx: Context) {
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "todo_write",
        options: { codemode: false, permission: "todo_write" },
        description: [
          "Track a multi-step task as a checklist the user can see. Use it when the work has three or more steps, spans several files or tools, or the user gave you a list; skip it for a single quick action.",
          "Send the whole list every time. Statuses: pending, in_progress, completed. Keep exactly one item in_progress while you work, mark it completed the moment it is done (not in a batch at the end), add items you discover, and drop items that stop being relevant.",
          "Never mark an item completed if tests fail, the output was not checked, or the step was only partly done.",
        ].join("\n"),
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.sync(() => {
            const completed = input.todos.filter((item) => item.status === "completed").length
            const current = input.todos.find((item) => item.status === "in_progress")
            const active = current ? (current.activeForm ?? current.content) : undefined
            const progressing = input.todos.filter((item) => item.status === "in_progress").length
            const notes = [
              `Checklist updated: ${completed} of ${input.todos.length} done.`,
              progressing > 1 ? "More than one item is in_progress; keep one at a time." : undefined,
              completed === input.todos.length && input.todos.length > 0
                ? "All items are complete: give the user the result."
                : "Continue with the next item.",
            ].filter((line): line is string => line !== undefined)
            return {
              output: { todos: input.todos, total: input.todos.length, completed, active },
              content: notes.join(" "),
              metadata: {},
            }
          }),
      }),
    )
  }),
}
