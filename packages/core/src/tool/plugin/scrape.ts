export * as ScrapeTool from "./scrape.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Permission } from "../../permission.js"
import { UltimateScrape } from "../../scrape/engine.js"
import { ScraperSetup } from "../../scrape/setup.js"

const StatusInput = Schema.Struct({})
const StatusOutput = Schema.Struct({ engines: Schema.Array(Schema.String) })

const guard = (permission: Permission.Interface, action: string, resources: string[], c: Tool.Context) =>
  permission
    .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
    .pipe(Effect.mapError((error) => new ToolFailure({ message: `Scraper permission denied: ${error.message}`, error })))

export const Plugin = {
  id: "opencode.tool.scrape",
  effect: Effect.fn("ScrapeTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const http = yield* HttpClient.HttpClient
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "scrape_fetch",
        options: { codemode: false, permission: "scrape.fetch" },
        description:
          "Fetch a page through the ultimate scraper: fast tier first, then stealth (camofox, scrapling), AI (scrapegraph), and channels (agent-reach) with fallback. Read-only. Respects robots and SSRF guards.",
        input: UltimateScrape.Input,
        output: UltimateScrape.Output,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "scrape.fetch", [input.url], c)
            const output = yield* UltimateScrape.run(http, input).pipe(
              Effect.mapError((error) => new ToolFailure({ message: `Unable to scrape ${input.url}. Try mode "stealth" or "ai" if you used "fast", read the page through the browser pane or ask the user to paste the content, and say plainly that the page could not be read.`, error })),
            )
            return { output, content: output.output || JSON.stringify(output), metadata: { engine: output.engine } }
          }),
      }),
    )
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "scrape_status",
        options: { codemode: false, permission: "scrape.status" },
        description: "Report ultimate scraper engine availability without making external requests.",
        input: StatusInput,
        output: StatusOutput,
        execute: (_input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "scrape.status", [c.sessionID], c)
            const output = { engines: ["webfetch", "scrapling", "camofox", "scrapegraph", "agent-reach"] }
            const statuses = yield* Effect.forEach(
              output.engines,
              (engine: string) =>
                ScraperSetup.ensure(engine).pipe(
                  Effect.map((status) => `${engine}: ${status}`),
                  Effect.orElseSucceed(() => `${engine}: probe failed`),
                ),
              { concurrency: 2 },
            )
            return { output, content: statuses.join("\n"), metadata: {} }
          }),
      }),
    )
  }),
}
