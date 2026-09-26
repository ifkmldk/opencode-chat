import type { FileContent } from "@/runtime/server/types"

export type ArtifactKind =
  | "image"
  | "svg"
  | "audio"
  | "video"
  | "pdf"
  | "html"
  | "markdown"
  | "mermaid"
  | "table"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "font"
  | "text"

const mimes = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["svg", "image/svg+xml"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["opus", "audio/ogg"],
  ["weba", "audio/webm"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["ogv", "video/ogg"],
  ["mkv", "video/x-matroska"],
  ["pdf", "application/pdf"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["mdx", "text/markdown"],
  ["mmd", "text/vnd.mermaid"],
  ["mermaid", "text/vnd.mermaid"],
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
])

export function artifactExtension(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")
  if (index <= 0) return ""
  return name.slice(index + 1).toLowerCase()
}

export function artifactMime(path: string) {
  return mimes.get(artifactExtension(path))
}

export function artifactKind(path: string): ArtifactKind {
  const mime = artifactMime(path)
  if (!mime) return "text"
  if (mime === "image/svg+xml") return "svg"
  if (mime === "application/pdf") return "pdf"
  if (mime === "text/html") return "html"
  if (mime === "text/markdown") return "markdown"
  if (mime === "text/vnd.mermaid") return "mermaid"
  if (mime === "text/csv" || mime === "text/tab-separated-values") return "table"
  if (mime.includes("wordprocessingml.document")) return "document"
  if (mime.includes("spreadsheetml.sheet")) return "spreadsheet"
  if (mime.includes("presentationml.presentation")) return "presentation"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("font/")) return "font"
  return "video"
}

/** Kinds whose bytes are kept as base64 so media and Office elements can render them. */
const binaryKinds = new Set<ArtifactKind>([
  "image",
  "audio",
  "video",
  "pdf",
  "document",
  "spreadsheet",
  "presentation",
  "font",
])

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0)
}

export function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
  }
  return btoa(parts.join(""))
}

/** Media above this stays a placeholder: base64 encoding on the main thread and the LRU budget both suffer. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

export function fileContentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)
  if (binaryKinds.has(kind)) {
    if (bytes.length > MAX_MEDIA_BYTES) return { type: "binary", content: "", size: bytes.length }
    return { type: "binary", content: bytesToBase64(bytes), encoding: "base64", mimeType }
  }
  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "", size: bytes.length }
  return { type: "text", content: new TextDecoder().decode(bytes), mimeType }
}

export function officeBytes(content: FileContent) {
  if (content.type !== "binary" || content.encoding !== "base64" || !content.content) return
  const raw = atob(content.content)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export const parseOfficeWorkbook = async (bytes: Uint8Array) => {
  const limit = 1000
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(bytes, { type: "array" })
  return workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name]!, { header: 1, raw: false }) as unknown[][]
    return { name, rows: rows.slice(0, limit + 1) }
  })
}

export const parseOfficeDocument = async (bytes: Uint8Array) => {
  const mammoth = await import("mammoth")
  const arrayBuffer = Uint8Array.from(bytes).buffer
  return (await mammoth.convertToHtml({ arrayBuffer })).value
}

export const parseOfficeSlides = async (bytes: Uint8Array) => {
  const { BlobReader, TextWriter, ZipReader } = await import("@zip.js/zip.js")
  const reader = new ZipReader(new BlobReader(new Blob([Uint8Array.from(bytes)])))
  try {
    const entries = await reader.getEntries()
    const slides = entries
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.filename))
      .map((entry) => entry.filename)
      .sort((a, b) => slideNumber(a) - slideNumber(b))
    return await Promise.all(
      slides.map(async (filename, index) => {
        const entry = entries.find((item) => item.filename === filename)!
        const xml = await entry.getData?.(new TextWriter())
        const text = typeof xml === "string" ? xml : ""
        return powerpointSlide(index + 1, text)
      }),
    )
  } finally {
    await reader.close()
  }
}

export function powerpointSlide(index: number, xml: string) {
  const runs = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g), (match) => decodeXml(match[1] ?? ""))
  return { index, title: runs[0], bullets: runs.slice(1) }
}

const slideNumber = (path: string) => Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
const decodeXml = (value: string) =>
  value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'")

/** Approximate on-disk size of loaded content. */
export function contentBytes(content: FileContent) {
  if (content.size !== undefined) return content.size
  if (content.encoding === "base64") {
    const padding = content.content.endsWith("==") ? 2 : content.content.endsWith("=") ? 1 : 0
    return Math.floor((content.content.length * 3) / 4) - padding
  }
  return new TextEncoder().encode(content.content).length
}

/**
 * Parse RFC 4180 style delimited text. Quoted fields may contain the delimiter, newlines, and
 * doubled quotes. Rows beyond `limit` are counted but not returned.
 */
export function parseDelimited(text: string, delimiter: string, limit = 1000) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let total = 0
  const endRow = () => {
    row.push(field)
    field = ""
    const blank = row.length === 1 && row[0] === ""
    if (!blank) {
      total++
      if (rows.length < limit) rows.push(row)
    }
    row = []
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char !== '"') {
        field += char
        continue
      }
      if (text[index + 1] === '"') {
        field += '"'
        index++
        continue
      }
      quoted = false
      continue
    }
    if (char === '"' && field === "") {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ""
      continue
    }
    if (char === "\r") continue
    if (char === "\n") {
      endRow()
      continue
    }
    field += char
  }
  if (field !== "" || row.length > 0) endRow()
  const columns = rows.reduce((max, current) => Math.max(max, current.length), 0)
  return { rows, total, columns }
}

/** Build a blob URL from loaded content. Callers revoke it when the viewer unmounts. */
export function blobUrlFromContent(content: FileContent) {
  const type = content.mimeType ?? "application/octet-stream"
  if (content.encoding !== "base64") return URL.createObjectURL(new Blob([content.content], { type }))
  const raw = atob(content.content)
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type }))
}

export type ArtifactExtraction = { text: string; truncated: boolean; pages?: number }

const PDF_PAGE_MARKER = "/Type /Page"

/** Cheap structural page count for PDF bytes; undefined when it is not a PDF. */
export function pdfPageCount(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return undefined
  }
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4_000_000)))
  const pages = ascii.split(PDF_PAGE_MARKER).length - 1
  return pages > 0 ? pages : undefined
}

/**
 * Best-effort text extraction from raw PDF bytes without a heavy parser.
 * Reads literal `(text)` and hex `<0068…>` strings inside content streams so
 * text PDFs become quotable; scanned PDFs return an empty string so the UI can
 * say "use OCR" instead of silently sending nothing. Caps output at 40k chars.
 */
export function extractPdfText(bytes: Uint8Array, limit = 40_000) {
  if (pdfPageCount(bytes) === undefined) return { text: "", truncated: false, pages: undefined }
  const ascii = new TextDecoder("latin1").decode(bytes)
  const parts: string[] = []
  let truncated = false
  const push = (value: string) => {
    const cleaned = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
    if (!cleaned.trim()) return
    for (const chunk of cleaned.split(/[\r\n]+/)) {
      const line = chunk.trim()
      if (!line) continue
      if (parts.join("\n").length + line.length + 1 > limit) {
        truncated = true
        return
      }
      parts.push(line)
    }
  }
  const literal = /\((?:\\.|[^\\)])*\)/g
  let match: RegExpExecArray | null
  while ((match = literal.exec(ascii)) !== null) {
    push(match[0].slice(1, -1))
    if (truncated) break
  }
  if (!truncated) {
    const hex = /<([0-9a-fA-F\s]+)>/g
    while ((match = hex.exec(ascii)) !== null) {
      const digits = match[1]!.replace(/\s+/g, "")
      if (digits.length < 4 || digits.length % 2 !== 0) continue
      try {
        const chars = Array.from({ length: digits.length / 2 }, (_, index) =>
          String.fromCharCode(Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16)),
        ).join("")
        push(chars)
      } catch {
        continue
      }
      if (truncated) break
      if (parts.length > 5_000) break
    }
  }
  return { text: parts.join("\n"), truncated, pages: pdfPageCount(bytes) }
}

/**
 * Resolve a relative link against a directory. A relative base yields a workspace-relative path and
 * an absolute base an absolute one; undefined when the link climbs past the base's root.
 */
export function resolveArtifactPath(base: string, href: string) {
  const target = href.replaceAll("\\", "/")
  if (target.startsWith("/")) return undefined
  const dir = base.replaceAll("\\", "/")
  const segments = [...dir.split("/").filter(Boolean)]
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue
    if (segment !== "..") {
      segments.push(segment)
      continue
    }
    if (segments.length === 0) return undefined
    segments.pop()
  }
  return `${dir.startsWith("/") ? "/" : ""}${segments.join("/")}`
}
