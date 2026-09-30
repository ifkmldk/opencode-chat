import { marked, type Token, type Tokens } from "marked"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { localImagePath, localLinkPath } from "../components/markdown-image"

export type AssistantArtifactKind =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "web"
  | "archive"
  | "file"
export type AssistantArtifact = { path: string; name: string; kind: AssistantArtifactKind }

// fork: file types a user asks the assistant to produce. Implicit signals (tool writes, inline code, bare paths)
// only count for these, so code edits never become cards; an explicit Markdown link cards any file.
const OUTPUT_KINDS: Record<Exclude<AssistantArtifactKind, "file">, readonly string[]> = {
  document: ["pdf", "doc", "docx", "odt", "rtf", "epub"],
  spreadsheet: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv"],
  presentation: ["ppt", "pptx", "odp", "key"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "svg", "heic"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"],
  video: ["mp4", "m4v", "webm", "mov", "ogv", "mkv", "avi"],
  web: ["html", "htm"],
  archive: ["zip", "7z", "rar", "tar", "gz", "tgz"],
}
const OUTPUT_KIND = new Map(
  Object.entries(OUTPUT_KINDS).flatMap(([kind, extensions]) =>
    extensions.map((extension) => [extension, kind as AssistantArtifactKind] as const),
  ),
)
// Text documents are labelled as documents but only become cards when linked.
const LINKED_DOCUMENTS = new Set(["md", "markdown", "mdx", "txt"])

const DRIVE_PATH = /(?<![\w\\/])[A-Za-z]:[\\/](?:[^\s<>"'`|*?:()[\]{}]+[\\/])*[^\s<>"'`|*?:()[\]{}\\/]+\.[A-Za-z0-9]{1,5}(?![\w\\/])/g
const ROOTED_PATH = /(?<![\w:/.\\~@-])\/(?:[\w.@+~-]+\/)*[\w.@+~-]+\.[A-Za-z0-9]{1,5}(?![\w/])/g
const RELATIVE_PATH = /(?<![\w:/.\\~@-])(?:\.{1,2}[\\/])?(?:[\w.@+~-]+[\\/])+[\w.@+~-]+\.[A-Za-z0-9]{1,5}(?![\w\\/])/g
const WRITE_RESULT = /^(?:Created|Wrote) file successfully: (.+)$/m

/** Files the assistant produced or pointed to across one turn (every assistant message of a user message). */
export function turnArtifacts(messages: readonly SessionMessageAssistant[], directory: string): AssistantArtifact[] {
  const found = new Map<string, AssistantArtifact>()
  const add = (value: string | undefined, explicit: boolean) => {
    const path = value && canonical(value, directory)
    if (!path) return
    const kind = artifactKind(path, explicit)
    if (!kind) return
    const key = identity(path, directory)
    if (!found.has(key)) found.set(key, { path, name: basename(path), kind })
  }
  const remove = (value: string) => {
    const path = canonical(value, directory)
    if (path) found.delete(identity(path, directory))
  }
  messages.forEach((message) =>
    message.content.forEach((content) => {
      if (content.type === "text") return scanText(content.text, add)
      if (content.type !== "tool" || content.state.status !== "completed") return
      const state = content.state
      if (content.name === "write") {
        const result = state.content.find((item) => item.type === "text")
        const path = result?.type === "text" ? WRITE_RESULT.exec(result.text)?.[1] : undefined
        add(path ?? (typeof state.input.path === "string" ? state.input.path : undefined), false)
      }
      if (content.name === "patch") {
        const files = state.metadata?.files
        if (Array.isArray(files))
          files.forEach((file) => {
            if (!file || typeof file !== "object" || Array.isArray(file) || typeof file.file !== "string") return
            if (file.status === "deleted") return remove(file.file)
            add(file.file, false)
          })
      }
      state.content.forEach((item) => {
        if (item.type === "file" && /^file:/i.test(item.uri)) add(localImagePath(item.uri), true)
      })
    }),
  )
  return [...found.values()]
}

function scanText(text: string, add: (path: string | undefined, explicit: boolean) => void) {
  const tokens = marked.lexer(text)
  marked.walkTokens(tokens, (token) => {
    if (token.type === "link" || token.type === "image") add(hrefPath(token as Tokens.Link | Tokens.Image), true)
    if (token.type === "codespan") add(codePath((token as Tokens.Codespan).text), false)
  })
  tokens.forEach((token) => {
    if (token.type === "code") return
    barePaths(prose(token)).forEach((path) => add(path, false))
  })
}

// marked eats a backslash before punctuation in a link target (`C:\tmp\_out` becomes `C:\tmp_out`),
// so Windows targets are read back from the raw source.
function hrefPath(token: Tokens.Link | Tokens.Image) {
  const raw = /\]\(\s*(?:<([^>]*)>|([^\s)]+))/.exec(token.raw)
  const href = token.href.includes("\\") ? (raw?.[1] ?? raw?.[2] ?? token.href) : token.href
  // `path:line` and `#L12` point at code, not at a produced file.
  if (/#L\d+/i.test(href) || /:\d+(?::\d+)?$/.test(href.split(/[?#]/, 1)[0] ?? "")) return
  const path = localLinkPath(href)
  if (!path || /[\\/]$/.test(path)) return
  return path
}

// Inline code counts only when the whole span is one path; spaces are allowed in absolute paths.
function codePath(text: string) {
  const value = text.trim()
  if (!value || /[\n"'<>|*?(){}[\];=,]/.test(value)) return
  if (/\s/.test(value) && !/^(?:[A-Za-z]:[\\/]|\/|file:)/i.test(value)) return
  return value
}

function prose(token: Token) {
  return token.raw
    .replace(/(```|~~~)[\s\S]*?\1/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>\s]*>/g, " ")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/\S+/gi, " ")
}

function barePaths(text: string) {
  return [DRIVE_PATH, ROOTED_PATH, RELATIVE_PATH]
    .flatMap((pattern) => [...text.matchAll(pattern)])
    .toSorted((a, b) => a.index - b.index)
    .map((match) => match[0])
}

/** One spelling per file: forward slashes, no `.` segments, `file:` URLs decoded, MSYS `/c/` drives restored. */
function canonical(value: string, directory: string) {
  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return
  const path = /^file:/i.test(trimmed) ? localImagePath(trimmed) : trimmed.replaceAll("\\", "/")
  if (!path || path.startsWith("//")) return
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) return
  const windows = /^[a-z]:\//i.test(directory.replaceAll("\\", "/"))
  const drive = windows ? path.replace(/^\/([a-z])\//i, (_, letter: string) => `${letter.toUpperCase()}:/`) : path
  const segments = drive.split("/").reduce<string[]>((result, segment, index) => {
    if (segment === "." || (segment === "" && index > 0)) return result
    const last = result.at(-1)
    // `..` climbs one folder, but never above a drive or root, and keeps leading `..` of relative paths.
    const climbs = last !== undefined && last !== ".." && !/^[a-z]:$/i.test(last) && !(last === "" && result.length === 1)
    if (segment === ".." && climbs) return result.slice(0, -1)
    return [...result, segment]
  }, [])
  const normalized = segments.join("/")
  if (!normalized || normalized === ".." || normalized.endsWith("/..")) return
  return normalized
}

function identity(path: string, directory: string) {
  const root = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const absolute = /^(?:[a-z]:\/|\/)/i.test(path) ? path : `${root}/${path}`
  return /^[a-z]:\//i.test(absolute) ? absolute.toLowerCase() : absolute
}

function artifactKind(path: string, explicit: boolean): AssistantArtifactKind | undefined {
  const extension = extensionOf(path)
  const kind = OUTPUT_KIND.get(extension)
  if (kind) return kind
  if (!explicit) return
  return LINKED_DOCUMENTS.has(extension) ? "document" : "file"
}

function extensionOf(path: string) {
  const name = basename(path)
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index + 1).toLowerCase() : ""
}

function basename(path: string) {
  return path.split("/").pop() || path
}
