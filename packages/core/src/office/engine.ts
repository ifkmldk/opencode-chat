export * as OfficeEngine from "./engine.js"

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OfficeKit } from "./kit.js"

// fork: render office files (and HTML) to PDF and PNG so the model can LOOK at what it made, the way Claude does.
// Engines, best first: the Microsoft Office that is installed on this machine (exact layout for docx/pptx/xlsx),
// then LibreOffice (headless), then Chromium for HTML. Nothing is installed by this module except the kit.

export type Engine = "word" | "powerpoint" | "excel" | "libreoffice" | "chromium"

const OFFICE_DIR = "C:\\Program Files\\Microsoft Office\\root\\Office16"
const OFFICE_DIR_X86 = "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16"
const OFFICE_EXE = { word: "WINWORD.EXE", powerpoint: "POWERPNT.EXE", excel: "EXCEL.EXE" } as const

const exists = (file: string) => {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

function officeApp(app: keyof typeof OFFICE_EXE) {
  if (process.platform !== "win32") return false
  return [OFFICE_DIR, OFFICE_DIR_X86].some((dir) => exists(path.join(dir, OFFICE_EXE[app])))
}

export function libreOffice() {
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"]
      : ["/usr/bin/soffice", "/usr/bin/libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"]
  return candidates.find(exists)
}

export function chromium() {
  const local = process.env.LOCALAPPDATA ?? ""
  const playwright = (() => {
    try {
      const root = path.join(local, "ms-playwright")
      return fs
        .readdirSync(root)
        .filter((dir) => /^chromium-\d+$/.test(dir))
        .toSorted()
        .reverse()
        .map((dir) => path.join(root, dir, "chrome-win64", "chrome.exe"))
        .find(exists)
    } catch {
      return undefined
    }
  })()
  if (playwright) return playwright
  return [
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(exists)
}

export type Kind = "docx" | "pptx" | "xlsx" | "pdf" | "html" | "image"

export function kindOf(file: string): Kind | undefined {
  const extension = path.extname(file).toLowerCase().slice(1)
  if (["docx", "doc", "rtf", "odt"].includes(extension)) return "docx"
  if (["pptx", "ppt", "odp"].includes(extension)) return "pptx"
  if (["xlsx", "xls", "xlsm", "ods", "csv"].includes(extension)) return "xlsx"
  if (extension === "pdf") return "pdf"
  if (["html", "htm"].includes(extension)) return "html"
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "image"
  return undefined
}

/** What can render each kind on this machine, best first. */
export function available(kind: Kind): Engine[] {
  const engines: Engine[] = []
  if (kind === "docx" && officeApp("word")) engines.push("word")
  if (kind === "pptx" && officeApp("powerpoint")) engines.push("powerpoint")
  if (kind === "xlsx" && officeApp("excel")) engines.push("excel")
  if (["docx", "pptx", "xlsx"].includes(kind) && libreOffice()) engines.push("libreoffice")
  if (kind === "html" && chromium()) engines.push("chromium")
  return engines
}

type Run = { code: number; output: string }

function run(command: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let output = ""
    child.stdout?.on("data", (chunk) => (output += String(chunk)))
    child.stderr?.on("data", (chunk) => (output += String(chunk)))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, output: `${output}\ntimed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

const powershell = (script: string, timeoutMs: number) => {
  const file = path.join(os.tmpdir(), `opencode-office-${process.pid}-${Date.now()}.ps1`)
  // UTF-8 with BOM so Windows PowerShell 5.1 reads non-ASCII paths correctly.
  fs.writeFileSync(file, `\uFEFF${script}`)
  return run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], timeoutMs).finally(() => {
    try {
      fs.unlinkSync(file)
    } catch {}
  })
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

/** Office processes with no window: leftovers of a COM export. Windows the user has open are never touched. */
async function strayPids(process_: string) {
  const result = await run(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", `Get-Process ${process_} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq 0 } | Select-Object -ExpandProperty Id`],
    15_000,
  )
  return result.output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => id > 0)
}

async function withCleanup(process_: string, action: () => Promise<Run>) {
  const before = await strayPids(process_)
  const result = await action()
  const leftovers = (await strayPids(process_)).filter((id) => !before.includes(id))
  if (leftovers.length)
    await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", leftovers.map((id) => `try{Stop-Process -Id ${id} -Force}catch{}`).join(";")], 20_000)
  return result
}

const SCRIPTS: Record<"word" | "powerpoint" | "excel", (input: string, output: string) => { script: string; process: string }> = {
  word: (input, output) => ({
    process: "WINWORD",
    script: `$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open(${quote(input)}, $false, $true)
  $doc.ExportAsFixedFormat(${quote(output)}, 17)
  $doc.Close($false)
} finally { $word.Quit() }`,
  }),
  powerpoint: (input, output) => ({
    process: "POWERPNT",
    script: `$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $presentation = $app.Presentations.Open(${quote(input)}, -1, 0, 0)
  $presentation.SaveAs(${quote(output)}, 32)
  $presentation.Close()
} finally { $app.Quit() }`,
  }),
  excel: (input, output) => ({
    process: "EXCEL",
    script: `$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Open(${quote(input)}, 0, $true)
  foreach ($sheet in $book.Worksheets) {
    try {
      $sheet.PageSetup.Zoom = $false
      $sheet.PageSetup.FitToPagesWide = 1
      $sheet.PageSetup.FitToPagesTall = $false
    } catch {}
  }
  $book.ExportAsFixedFormat(0, ${quote(output)})
  $book.Close($false)
} finally { $excel.Quit() }`,
  }),
}

async function excelViaHtml(input: string, output: string, previous: Run): Promise<Run> {
  const directory = path.join(path.dirname(output), "sheets")
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  const script = `$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Open(${quote(input)}, 0, $true)
  $index = 0
  foreach ($sheet in $book.Worksheets) {
    if ($sheet.Visible -ne -1) { continue }
    $index++
    $sheet.Copy()
    $copy = $excel.ActiveWorkbook
    $copy.SaveAs((${quote(directory + path.sep)} + 'sheet_' + $index + '.htm'), 44)
    $copy.Close($false)
  }
  $book.Close($false)
} finally { $excel.Quit() }`
  const exported = await withCleanup("EXCEL", () => powershell(script, 180_000))
  const pages = fs
    .readdirSync(directory)
    .filter((name) => /^sheet_\d+\.files$/.test(name))
    .toSorted((a, b) => Number.parseInt(a.slice(6), 10) - Number.parseInt(b.slice(6), 10))
    .map((name) => path.join(directory, name, "sheet001.htm"))
    .filter(exists)
  if (!pages.length) return { code: -1, output: `${previous.output}\n${exported.output}` }
  const pdfs: string[] = []
  for (const [index, page] of pages.entries()) {
    const pdf = path.join(directory, `sheet_${index + 1}.pdf`)
    // Excel's sheet page redirects itself into its tabbed frameset, which would print a tab strip. Print a copy
    // without that script (next to the original so the stylesheet link still resolves).
    const printable = page.replace(/\.htm$/, ".print.htm")
    fs.writeFileSync(printable, fs.readFileSync(page, "utf8").replace(/<script[\s\S]*?<\/script>/gi, ""))
    await run(
      chromium()!,
      ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, `file:///${printable.replaceAll("\\", "/")}`],
      120_000,
    )
    pdfs.push(pdf)
  }
  return OfficeKit.node([path.join(OfficeKit.directory(), "merge-pdf.mjs"), output, ...pdfs], 60_000)
}

async function toPdfWith(engine: Engine, input: string, output: string): Promise<Run> {
  if (engine === "word" || engine === "powerpoint" || engine === "excel") {
    const spec = SCRIPTS[engine](input, output)
    const direct = await withCleanup(spec.process, () => powershell(spec.script, 180_000))
    if (engine !== "excel" || exists(output) || !chromium()) return direct
    // Excel refuses to export PDF when Windows has no printer installed. Fall back to one HTML page per sheet,
    // printed by Chromium and merged, which keeps Excel's own rendering of fonts, fills, borders and number formats.
    return excelViaHtml(input, output, direct)
  }
  if (engine === "libreoffice") {
    const profile = path.join(os.tmpdir(), "opencode-lo-profile")
    const result = await run(libreOffice()!, [`-env:UserInstallation=file:///${profile.replaceAll("\\", "/")}`, "--headless", "--convert-to", "pdf", "--outdir", path.dirname(output), input], 180_000)
    // soffice names the PDF after the input; move it to the requested name.
    const produced = path.join(path.dirname(output), `${path.basename(input, path.extname(input))}.pdf`)
    if (produced !== output && exists(produced)) fs.renameSync(produced, output)
    return result
  }
  const url = `file:///${input.replaceAll("\\", "/")}`
  return run(chromium()!, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${output}`, url], 120_000)
}

export type Rendered = {
  readonly pdf: string
  readonly engine: Engine | "none"
  readonly pages: number
  readonly files: ReadonlyArray<{ page: number; file: string; width: number; height: number }>
  readonly directory: string
}

export type RenderInput = { file: string; pages?: string; scale?: number; outDir?: string; engine?: Engine }

export function outputDirectory(file: string) {
  const id = createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 10)
  return path.join(os.tmpdir(), "opencode", "render", `${path.basename(file, path.extname(file))}-${id}`)
}

const safeName = (file: string) => path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, "_")

/** Convert a docx/pptx/xlsx/html file to PDF inside `directory` with the best engine available. Throws an actionable Error. */
export async function toPdf(source: string, directory: string, engine?: Engine): Promise<{ pdf: string; engine: Engine }> {
  const kind = kindOf(source)
  if (!kind || kind === "pdf" || kind === "image") throw new Error(`Cannot convert ${path.extname(source) || "this file type"} to PDF.`)
  const engines = engine ? [engine] : available(kind)
  if (!engines.length)
    throw new Error(
      `No engine can render ${kind} here. Install Microsoft Office or LibreOffice${kind === "html" ? " or a Chromium-based browser" : ""}, then retry.`,
    )
  const kit = await OfficeKit.ensure()
  if (!kit.ready) throw new Error(kit.message)
  fs.mkdirSync(directory, { recursive: true })
  const prefix = safeName(source)
  // Work on a copy: Office locks the file it opens, and the original may be open in a window.
  const copy = path.join(directory, `${prefix}${path.extname(source)}`)
  if (kind !== "html" && copy !== source) fs.copyFileSync(source, copy)
  const pdf = path.join(directory, `${prefix}.pdf`)
  if (exists(pdf)) fs.unlinkSync(pdf)
  const failures: string[] = []
  for (const candidate of engines) {
    const result = await toPdfWith(candidate, kind === "html" ? source : copy, pdf)
    if (exists(pdf)) return { pdf, engine: candidate }
    failures.push(`${candidate}: ${result.output.trim().slice(-300) || `exit ${result.code}`}`)
  }
  throw new Error(`Rendering failed.\n${failures.join("\n")}`)
}

/** Convert to PDF (when needed) and rasterize the requested pages. Throws an Error with an actionable message. */
export async function render(input: RenderInput): Promise<Rendered> {
  const source = path.resolve(input.file)
  if (!exists(source)) throw new Error(`File not found: ${source}`)
  const kind = kindOf(source)
  if (!kind) throw new Error(`Cannot render ${path.extname(source) || "this file type"}; supported: docx, pptx, xlsx, pdf, html, png/jpg.`)
  if (kind === "image") throw new Error("That is already an image: open it with the read tool.")
  const kit = await OfficeKit.ensure()
  if (!kit.ready) throw new Error(kit.message)
  const directory = input.outDir ? path.resolve(input.outDir) : outputDirectory(source)
  fs.mkdirSync(directory, { recursive: true })
  const prefix = safeName(source)
  const converted = kind === "pdf" ? { pdf: source, engine: "none" as const } : await toPdf(source, directory, input.engine)

  const images = await OfficeKit.node(
    [path.join(OfficeKit.directory(), "render-pdf.mjs"), converted.pdf, directory, String(input.scale ?? 1.5), input.pages ?? "all", prefix],
    180_000,
  )
  if (images.code !== 0) throw new Error(`Rasterizing the PDF failed: ${images.output.trim().slice(-400)}`)
  const parsed = JSON.parse(images.output.slice(images.output.indexOf("{"))) as { pages: number; files: Rendered["files"] }
  return { pdf: converted.pdf, engine: converted.engine, pages: parsed.pages, files: parsed.files, directory }
}
