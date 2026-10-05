import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const todoToolNode = makeLocationNode({
  name: "test/todo-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(TodoTool.Plugin)),
  deps: [Tool.node],
})
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, todoToolNode]), [Permission.node.replace(permissionLayer({}))]),
)

const call = (input: unknown) => ({
  sessionID: Session.ID.make("ses_todo_test"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-todo", name: "todo_write", input },
})

describe("TodoTool", () => {
  it.effect("reports progress and the active item", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const todos = [
        { content: "Draft outline", status: "completed" },
        { content: "Write slides", status: "in_progress", activeForm: "Writing slides" },
        { content: "Render and check", status: "pending" },
      ]
      expect(yield* executeTool(registry, call({ todos }))).toMatchObject({
        status: "completed",
        output: { todos, total: 3, completed: 1, active: "Writing slides" },
        content: [{ type: "text", text: "Checklist updated: 1 of 3 done. Continue with the next item." }],
      })
    }),
  )

  it.effect("warns about several active items and celebrates a finished list", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const two = yield* executeTool(
        registry,
        call({ todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] }),
      )
      expect(JSON.stringify(two)).toContain("More than one item is in_progress")
      const done = yield* executeTool(registry, call({ todos: [{ content: "a", status: "completed" }] }))
      expect(JSON.stringify(done)).toContain("All items are complete")
    }),
  )

  it.effect("rejects an unknown status", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect(yield* executeTool(registry, call({ todos: [{ content: "a", status: "done" }] }))).toMatchObject({ status: "error" })
    }),
  )
})
