/// <reference path="./text.d.ts" />
export * as OfficeKit from "./kit.js"

import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import deck from "./kit/deck.mjs.txt" with { type: "text" }
import design from "./kit/design.mjs.txt" with { type: "text" }
import mergePdf from "./kit/merge-pdf.mjs.txt" with { type: "text" }
import renderPdf from "./kit/render-pdf.mjs.txt" with { type: "text" }
import report from "./kit/report.mjs.txt" with { type: "text" }
import sheet from "./kit/sheet.mjs.txt" with { type: "text" }

// fork: the office kit is a small folder of libraries and layout helpers that the model's own scripts import
// (pptxgenjs, docx, exceljs, pdf.js). It lives outside the app bundle so it can use native modules, and is installed
// once, on first use, with npm. Everything it needs is written from the files embedded here.

const DEPENDENCIES = {
  docx: "9.7.1",
  exceljs: "^4.4.0",
  mupdf: "^1.3.0",
  "pdf-lib": "^1.17.1",
  pptxgenjs: "4.0.1",
}

const FILES: Record<string, string> = {
  "deck.mjs": deck,
  "design.mjs": design,
  "merge-pdf.mjs": mergePdf,
  "render-pdf.mjs": renderPdf,
  "report.mjs": report,
  "sheet.mjs": sheet,
}

export function directory() {
  return process.env.OPENCODE_OFFICE_KIT ?? path.join(os.homedir(), ".local", "share", "opencode", "office-kit")
}

const signature = () =>
  createHash("sha256")
    .update(JSON.stringify(DEPENDENCIES))
    .update(Object.entries(FILES).flat().join("\0"))
    .digest("hex")
    .slice(0, 16)

export type Status = {
  readonly directory: string
  readonly ready: boolean
  readonly installed: boolean
  readonly message: string
}

function run(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: process.platform === "win32" })
    let output = ""
    child.stdout?.on("data", (chunk) => (output += String(chunk)))
    child.stderr?.on("data", (chunk) => (output += String(chunk)))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, output: `${output}\ntimed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: String(error.message) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

let pending: Promise<Status> | undefined

/** Write the kit files and install its dependencies when needed. Safe to call often; concurrent calls share one run. */
export function ensure(): Promise<Status> {
  pending ??= install().finally(() => (pending = undefined))
  return pending
}

async function install(): Promise<Status> {
  const dir = directory()
  fs.mkdirSync(dir, { recursive: true })
  const marker = path.join(dir, ".kit-signature")
  const current = signature()
  const ready = fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === current && fs.existsSync(path.join(dir, "node_modules", "pptxgenjs"))
  Object.entries(FILES).forEach(([name, content]) => {
    const file = path.join(dir, name)
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content)
  })
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "opencode-office-kit", private: true, type: "module", dependencies: DEPENDENCIES }, null, 2),
  )
  if (ready) return { directory: dir, ready: true, installed: false, message: "Office kit is ready." }
  if (process.env.OPENCODE_OFFICE_NO_INSTALL === "1")
    return { directory: dir, ready: false, installed: false, message: "Office kit is not installed and auto-install is disabled (OPENCODE_OFFICE_NO_INSTALL=1)." }
  const result = await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir, 5 * 60_000)
  if (result.code !== 0)
    return { directory: dir, ready: false, installed: false, message: `npm install failed (${result.code}): ${result.output.trim().slice(-600)}` }
  fs.writeFileSync(marker, current)
  return { directory: dir, ready: true, installed: true, message: "Office kit installed." }
}

/** Run a kit script (or any .mjs) with node from the kit directory so it resolves the kit's modules. */
export function node(args: string[], timeoutMs = 120_000) {
  return run("node", args, directory(), timeoutMs)
}

/** Snippet the model can paste at the top of its own script. */
export function importHint() {
  const dir = directory().replaceAll("\\", "/")
  return [
    `import { createDeck } from "file:///${dir}/deck.mjs"      // slides (pptxgenjs)`,
    `import { createReport } from "file:///${dir}/report.mjs"   // Word (docx)`,
    `import { createWorkbook } from "file:///${dir}/sheet.mjs"  // Excel (exceljs)`,
    `import { palettes, fonts } from "file:///${dir}/design.mjs"`,
    "Run scripts with: node <script>.mjs (from any folder; the imports are absolute).",
  ].join("\n")
}
