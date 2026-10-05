/// <reference path="../markdown.d.ts" />

export * as OfficePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { AbsolutePath } from "../schema.js"
import { Skill } from "../skill.js"
import { OfficeKit } from "./kit.js"
import design from "./skill/design.md" with { type: "text" }
import docx from "./skill/docx.md" with { type: "text" }
import pdf from "./skill/pdf.md" with { type: "text" }
import pptx from "./skill/pptx.md" with { type: "text" }
import xlsx from "./skill/xlsx.md" with { type: "text" }

// fork: built-in skills for documents. They carry the recipes (office kit), the design rules and the mandatory
// render-then-look loop, so the model produces designed files instead of default-styled ones.

const SKILLS = [
  {
    id: "office-design",
    name: "Office Design",
    description:
      "Use BEFORE creating or restyling any document, presentation, spreadsheet, report, CV, brochure or PDF: design process, palette and font choice, anti-slop rules and the render-and-look checklist. Read it together with the format skill (pptx, docx, xlsx, pdf).",
    content: design,
  },
  {
    id: "pptx",
    name: "PowerPoint",
    description:
      "Use to create, redesign or edit PowerPoint decks and slides (.pptx): pitch decks, reports, lessons, keynotes. Covers the layout kit, slide types, structure and editing existing decks.",
    content: pptx,
  },
  {
    id: "docx",
    name: "Word",
    description:
      "Use to create or edit Word documents (.docx): reports, proposals, letters, memos, CVs, contracts, policies. Covers the report kit with real styles, lists and tables, and editing existing documents.",
    content: docx,
  },
  {
    id: "xlsx",
    name: "Excel",
    description:
      "Use to create, clean, analyze or edit Excel workbooks (.xlsx, .csv): data tables, budgets, trackers, models with formulas, charts. Covers the workbook kit, formulas, number formats and native charts.",
    content: xlsx,
  },
  {
    id: "pdf",
    name: "PDF",
    description:
      "Use to read, create, merge, split, fill or visually inspect PDF files, and to turn designed HTML into PDF (brochures, one-pagers, invoices, certificates).",
    content: pdf,
  },
] as const

export const Plugin = define({
  id: "opencode.office",
  effect: Effect.fn("OfficePlugin")(function* (ctx) {
    const kit = OfficeKit.directory().replaceAll("\\", "/")
    yield* ctx.skill.transform((editor) =>
      SKILLS.forEach((skill) =>
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make(skill.id),
            name: Skill.Name.make(skill.name),
            description: skill.description,
            path: AbsolutePath.make(`/builtin/${skill.id}.md`),
            content: skill.content.replaceAll("{{KIT}}", kit),
          }),
        ),
      ),
    )
  }),
})
