import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { BrowserTool } from "@opencode/core/tool/plugin/browser"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const browserToolNode = makeLocationNode({
  name: "test/browser-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(BrowserTool.Plugin)),
  deps: [Tool.node, Permission.node],
})
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, browserToolNode]), [Permission.node.replace(permissionLayer({}))]),
)

const call = (input: unknown) => ({
  sessionID: Session.ID.make("ses_browser_test"),
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-browser", name: "web_browser", input },
})

describe("BrowserTool", () => {
  it.effect("refuses loopback and metadata addresses before opening anything", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      for (const url of ["http://127.0.0.1:9/x", "http://169.254.169.254/latest/meta-data/"]) {
        const result = yield* executeTool(registry, call({ url, screenshot: "none" }))
        expect(result.status).toBe("error")
      }
    }),
  )

  it.effect("never types into a password field", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const result = yield* executeTool(registry, call({ url: "https://example.com/", steps: [{ do: "fill", target: "password", text: "x" }] }))
      expect(result.status).toBe("error")
      expect(JSON.stringify(result)).toContain("never types passwords")
    }),
  )
})

describe("BrowserTool catalog", () => {
  it.effect("is advertised to the model", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const snapshot = yield* registry.snapshot([])
      expect(snapshot.definitions.map((item) => item.name)).toContain("web_browser")
    }),
  )
})
