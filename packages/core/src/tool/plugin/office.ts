export * as OfficeTool from "./office.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import fs from "node:fs"
import { OfficeEngine } from "../../office/engine.js"
import { OfficeKit } from "../../office/kit.js"
import { Permission } from "../../permission.js"

// fork: office_render turns a docx/pptx/xlsx/pdf/html file into page images the model can look at, which is the
// step that separates a designed document from a blind one. office_kit installs/locates the layout kit that the
// docx/pptx/xlsx skills tell the model to import.

const MAX_INLINE = 4

const RenderInput = Schema.Struct({
  file: Schema.String.annotate({ description: "Path to a .docx, .pptx, .xlsx, .pdf or .html file." }),
  pages: Schema.optional(Schema.String).annotate({
    description: 'Pages or slides to return as images, e.g. "1", "2-4" or "1,3,5". Default: the first 4; ask for the rest in further calls.',
  }),
  scale: Schema.optional(Schema.Finite).annotate({ description: "Zoom for the images, 0.5 to 4. Default 1.1 (about 1050px for a slide)." }),
})
const RenderOutput = Schema.Struct({
  pdf: Schema.String,
  engine: Schema.String,
  pages: Schema.Number,
  files: Schema.Array(Schema.Struct({ page: Schema.Number, file: Schema.String })),
})

const KitInput = Schema.Struct({})
const KitOutput = Schema.Struct({
  directory: Schema.String,
  ready: Schema.Boolean,
  installed: Schema.Boolean,
  message: Schema.String,
  engines: Schema.Array(Schema.String),
})

const guard = (permission: Permission.Interface, action: string, resources: string[], c: Tool.Context) =>
  permission
    .assert({ action, resources, sessionID: c.sessionID, agent: c.agent, source: { type: "tool", messageID: c.messageID, id: c.id } })
    .pipe(Effect.mapError((error) => new ToolFailure({ message: `Office permission denied: ${error.message}`, error })))

const mime = (file: string) => (file.endsWith(".png") ? "image/png" : "image/jpeg")

export const Plugin = {
  id: "opencode.tool.office",
  effect: Effect.fn("OfficeTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "office_render",
        options: { codemode: false, permission: "office.render" },
        description:
          "Render a Word, PowerPoint, Excel, PDF or HTML file to page images and show them to you. ALWAYS call this on every document, deck or workbook you create or edit and look at each page before telling the user it is done: fix overflowing text, clipped tables, low contrast and uneven spacing, then render again. Uses the Microsoft Office or LibreOffice installed on this computer (HTML: a Chromium browser). Returns up to 4 page images per call; pass `pages` for the others (e.g. 5-8).",
        input: RenderInput,
        output: RenderOutput,
        execute: (input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "office.render", [input.file], c)
            const wanted = input.pages ?? `1-${MAX_INLINE}`
            const result = yield* Effect.tryPromise({
              try: () => OfficeEngine.render({ file: input.file, pages: wanted, scale: input.scale ?? 1.1 }),
              catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
            })
            const shown = result.files.slice(0, MAX_INLINE)
            const files = shown.map((item) => ({ page: item.page, file: item.file }))
            const summary = [
              `Rendered ${input.file} with ${result.engine}: ${result.pages} page${result.pages === 1 ? "" : "s"}, showing ${shown.map((item) => item.page).join(", ") || "none"}.`,
              `PDF: ${result.pdf}`,
              "Check every image for: text overflowing or clipped, overlapping elements, low contrast, uneven margins, widows, empty areas, tables running off the page. Fix the source and render again.",
            ].join("\n")
            const images = yield* Effect.forEach(shown, (item) =>
              Effect.sync(() => ({
                type: "file" as const,
                uri: `data:${mime(item.file)};base64,${fs.readFileSync(item.file).toString("base64")}`,
                mime: mime(item.file),
                name: item.file,
              })),
            )
            return {
              output: { pdf: result.pdf, engine: result.engine, pages: result.pages, files },
              content: [{ type: "text" as const, text: summary }, ...images],
              metadata: { engine: result.engine, pages: result.pages, pdf: result.pdf, files },
            }
          }),
      }),
    )
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "office_kit",
        options: { codemode: false, permission: "office.kit" },
        description:
          "Install (first use only, needs internet and npm) and locate the office kit: layout helpers for decks (pptxgenjs), Word reports (docx) and workbooks (exceljs), plus the engines available for office_render. Returns the import lines to paste into your own .mjs script. Read the pptx, docx or xlsx skill first.",
        input: KitInput,
        output: KitOutput,
        execute: (_input, c) =>
          Effect.gen(function* () {
            yield* guard(permission, "office.kit", [c.sessionID], c)
            const status = yield* Effect.promise(() => OfficeKit.ensure())
            const engines = (["docx", "pptx", "xlsx", "html"] as const).map((kind) => `${kind}: ${OfficeEngine.available(kind).join(", ") || "none"}`)
            return {
              output: { ...status, engines },
              content: [status.message, `Kit folder: ${status.directory}`, `Render engines — ${engines.join("; ")}`, "", status.ready ? OfficeKit.importHint() : ""].join("\n"),
              metadata: {},
            }
          }),
      }),
    )
  }),
}
