import { marked } from "marked"

export type AssistantArtifact = { path: string; label: string; kind: "image" | "audio" | "video" | "document" | "file" }

const artifactExtension = (path: string) => path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? ""
const kind = (path: string): AssistantArtifact["kind"] => {
  const ext = artifactExtension(path)
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "svg"].includes(ext)) return "image"
  if (["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"].includes(ext)) return "audio"
  if (["mp4", "m4v", "webm", "mov", "ogv", "mkv"].includes(ext)) return "video"
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "tsv", "rtf", "odt", "ods", "odp"].includes(ext))
    return "document"
  return "file"
}

const basename = (path: string) => path.split(/[\\/]/).pop() || path

/** Pull explicit local-file links from the assistant's final Markdown into a small artifact module. */
export function assistantArtifacts(text: string): AssistantArtifact[] {
  const result = new Map<string, AssistantArtifact>()
  marked.walkTokens(marked.lexer(text), (token) => {
    if (token.type !== "link") return
    const href = token.href.trim()
    if (!href || /^(?:[a-z]+:|#)/i.test(href)) return
    const path = href.replace(/[?#].*$/, "").replace(/:\d+(?::\d+)?$/, "")
    if (!path || path.endsWith("/") || path === "." || path === "..") return
    const existing = result.get(path)
    if (!existing) {
      const label = token.text?.trim() || basename(path)
      result.set(path, { path, label, kind: kind(path) })
    }
  })
  return [...result.values()]
}
