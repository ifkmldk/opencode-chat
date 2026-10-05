export * as ScrapeTool from "./scrape.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Permission } from "../../permission.js"
import { UltimateScrape } from "../../scrape/engine.js"
import { ScraperSetup } from "../../scrape/setup.js"
import { ScrapeChromium } from "../../scrape/chromium.js"

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
          "Read a web page the way a browser would. Default (auto) tries a plain fetch, then a headless Chrome/Brave render that runs the page scripts, so JavaScript-built careers pages and blocked sites usually work; mode \"stealth\" starts with the browser and adds camofox/scrapling, \"ai\" uses scrapegraph, \"channels\" agent-reach. Returns the main content as markdown plus schema.org JobPosting data when present. Fails with the reasons when nothing readable comes back: then say so, never guess the page. Read-only.",
        input: UltimateScrape.Input,
        output: UltimateScrape.Output,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "scrape.fetch", [input.url], c)
            const output = yield* UltimateScrape.run(http, input).pipe(
              Effect.mapError((error) => new ToolFailure({ message: `Unable to scrape ${input.url}. Try mode "stealth" or "ai" if you used "fast", read the page through the browser pane or ask the user to paste the content, and say plainly that the page could not be read.`, error })),
            )
            // fork: nothing readable is a failure the model must see, not an empty page it can fill in from memory.
            if (!output.output.trim())
              return yield* new ToolFailure({
                message: `Could not read ${input.url}. ${output.warnings.join(" | ")}. Do not guess its content: say plainly that the page could not be read, try another source (the company job board, a search result snippet, a different URL), or ask the user to paste the text.`,
              })
            const note = output.warnings.find((item) => item.startsWith("The page text is short"))
            return { output, content: note ? `${note}\n\n${output.output}` : output.output, metadata: { engine: output.engine } }
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
            const output = { engines: ["webfetch", "chromium", "scrapling", "camofox", "scrapegraph", "agent-reach"] }
            const statuses = yield* Effect.forEach(
              output.engines,
              (engine: string) =>
                (engine === "webfetch"
                  ? Effect.succeed("ready (plain HTTP)")
                  : engine === "chromium"
                    ? Effect.succeed(
                        ScrapeChromium.available()
                          ? `ready (${ScrapeChromium.available()})`
                          : "not available: no Chrome, Brave or Playwright Chromium found",
                      )
                    : ScraperSetup.ensure(engine).pipe(
                        Effect.map((status) => `${status} (package check only, not a test fetch; first use may download packages)`),
                      )
                ).pipe(
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
