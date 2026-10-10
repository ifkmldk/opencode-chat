export * as MemoryDigest from "./digest.js"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// fork: a short digest of the shared vault written into each agent's global instructions file (AGENTS.md), so every session
// starts with recent memory without a tool or MCP call. The block is delimited by markers; text outside it is never touched.

export const START = "<!-- vault-digest:start -->"
export const END = "<!-- vault-digest:end -->"

type Note = { title: string; updated: number; body: string; kind: string }

const frontmatter = (raw: string) => {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  const lines = (match?.[1] ?? "").split("\n")
  const fields: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const index = lines[i]!.indexOf(":")
    if (index <= 0) continue
    const key = lines[i]!.slice(0, index).trim()
    let value = lines[i]!.slice(index + 1).trim()
    if (value === ">-" || value === ">" || value === "|") {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) parts.push(lines[++i]!.trim())
      value = parts.join(" ")
    }
    fields[key] = value.replace(/^'|'$/g, "")
  }
  return { fields, body: match ? raw.slice(match[0].length) : raw }
}

const markdownFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(file)
    return entry.name.endsWith(".md") ? [file] : []
  })
}

const load = (vault: string, folder: string): Note[] =>
  markdownFiles(path.join(vault, folder)).flatMap((file) => {
    try {
      const { fields, body } = frontmatter(fs.readFileSync(file, "utf8"))
      return [{ title: fields.title ?? path.basename(file, ".md"), updated: Number(fields.updated) || 0, body, kind: fields.kind ?? folder }]
    } catch {
      return []
    }
  })

// The first request line of a session note, or the first body line of an entry: enough to recognise the topic.
const gist = (note: Note) => {
  const request = note.body.match(/^- (.+)$/m)?.[1] ?? note.body.split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? ""
  return request
    .replace(/\[gambar\]|\[lampiran[^\]]*\]|\[image[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
}

// Noise that carries no memory: injected reminders and wrapper tags.
const noisy = (text: string) => /<system-reminder|<user_input|<explicit_instructions|<mode_notice/.test(text)

/** Markdown block with the newest sessions and entries, capped by byte size. */
export function build(vault: string, maxBytes = 30_000) {
  const seen = new Set<string>()
  const sessions = load(vault, "sessions")
    .sort((a, b) => b.updated - a.updated)
    .filter((note) => {
      const text = gist(note)
      const key = `${note.title}|${text}`
      if (seen.has(key) || noisy(text) || text.length < 8) return false
      seen.add(key)
      return true
    })
    .slice(0, 40)
  const entries = load(vault, "entries")
    .sort((a, b) => b.updated - a.updated)
    .filter((note) => !noisy(note.title) && note.title.length > 3)
    .slice(0, 30)
  const lines = [
    START,
    "## Memory bersama (otomatis, jangan diedit manual)",
    "Dibuat dari vault `opencode-memory` oleh vault-sync. Ini ringkasan saja; detail lengkap ada di transcripts/ dan sessions/ di vault.",
    "",
    "### Sesi terbaru",
    ...sessions.map((note) => `- ${note.title.replace(/^Sesi /, "")}: ${gist(note)}`),
    "",
    "### Catatan & keputusan terbaru",
    ...entries.map((note) => `- [${note.kind}] ${note.title}`),
    END,
  ]
  let text = lines.join("\n")
  while (Buffer.byteLength(text, "utf8") > maxBytes && lines.length > 6) {
    lines.splice(lines.length - 2, 1)
    text = lines.join("\n")
  }
  return text
}

/** Replace the digest block in `file` (or append it), creating the file when missing. Other content stays as it is. */
export function write(file: string, block: string) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`)
  const next = pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`
  if (next === current) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next)
  return true
}

/** Global instruction files that agents read at session start. Only written when the agent's folder already exists. */
export function targets(home = os.homedir()): Array<{ agent: string; file: string; dir: string; gate?: string }> {
  return [
    { agent: "opencode", file: path.join(home, ".config", "opencode", "AGENTS.md"), dir: path.join(home, ".config", "opencode") },
    { agent: "codex", file: path.join(home, ".codex", "AGENTS.md"), dir: path.join(home, ".codex") },
    // Cline reads every .md under its global rules folder (DocumentsClineRules). Only written when the Cline extension has storage here.
    { agent: "cline", file: path.join(home, "Documents", "Cline", "Rules", "vault-digest.md"), dir: path.join(home, "Documents", "Cline"), gate: path.join(home, "AppData", "Roaming", "Code", "User", "globalStorage", "saoudrizwan.claude-dev") },
    // Antigravity reads GEMINI.md / AGENTS.md from its config folder; the global location is not documented, so this is verified by its digest block only.
    { agent: "antigravity", file: path.join(home, ".gemini", "GEMINI.md"), dir: path.join(home, ".gemini") },
  ].filter((target) => fs.existsSync(target.gate ?? target.dir))
}
