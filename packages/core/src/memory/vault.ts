export * as MemoryVaultFiles from "./vault.js"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryVault } from "./obsidian-sync.js"
import { MemoryRank } from "./rank.js"

// fork: the Obsidian vault as a memory source. The vault is plain markdown with frontmatter (see obsidian-sync.ts), so the
// same notes serve every agent. Reading is on whenever the folder exists; writing a note when `memory_save` is used is on by
// default and can be switched off. Settings, in order: OPENCODE_MEMORY_VAULT, <config>/memory.json, the default folder.
//
//   <config>/memory.json:  { "vaultDir": "C:/Users/me/Documents/Obsidian/opencode-memory", "write": true }

export type Settings = { dir?: string; write: boolean }

export function settings(configDir: string, env: NodeJS.ProcessEnv = process.env): Settings {
  let file: { vaultDir?: unknown; write?: unknown } = {}
  try {
    file = JSON.parse(fs.readFileSync(path.join(configDir, "memory.json"), "utf8")) as typeof file
  } catch {
    // no file or invalid JSON: defaults
  }
  const fallback = path.join(os.homedir(), "Documents", "Obsidian", "opencode-memory")
  const candidate = env.OPENCODE_MEMORY_VAULT ?? (typeof file.vaultDir === "string" ? file.vaultDir : fallback)
  const dir = fs.existsSync(path.join(candidate, "entries")) ? candidate : undefined
  return { dir, write: file.write !== false }
}

const cache = new Map<string, { signature: string; entries: MemoryVault.VaultEntry[] }>()

/**
 * Notes for recall: `<dir>/entries` (memory_save) plus `<dir>/sessions` (session summaries and Claude Code memory notes copied
 * by MemorySessions). Each folder is parsed once per change (count + newest modification time). Transcripts are not here: they
 * are large and are searched on demand by `searchTranscripts`.
 */
export function read(dir: string): MemoryVault.VaultEntry[] {
  return [...folder(path.join(dir, "entries"), false), ...folder(path.join(dir, "sessions"), true)]
}

function folder(root: string, nested: boolean): MemoryVault.VaultEntry[] {
  const files = markdown(root, nested)
  const newest = files.reduce((max, file) => {
    try {
      return Math.max(max, fs.statSync(file).mtimeMs)
    } catch {
      return max
    }
  }, 0)
  const signature = `${files.length}:${newest}`
  const hit = cache.get(root)
  if (hit?.signature === signature) return hit.entries
  const entries = files.flatMap((file) => {
    try {
      const entry = MemoryVault.fromMarkdown(path.basename(file, ".md"), fs.readFileSync(file, "utf8"))
      return entry ? [entry] : []
    } catch {
      return []
    }
  })
  cache.set(root, { signature, entries })
  return entries
}

function markdown(root: string, nested: boolean): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(root, entry.name)
      if (entry.isDirectory()) return nested ? markdown(file, true) : []
      return entry.name.endsWith(".md") ? [file] : []
    })
  } catch {
    return []
  }
}

/**
 * Full transcripts ranked by how many of the query's words they contain (at least two, or most of a short query) and how
 * often, with an excerpt around the rarest matching word. The excerpt is what the model reads; the file has the rest.
 */
export function searchTranscripts(dir: string, query: string, limit = 5) {
  const words = MemoryRank.tokens(query)
  if (words.length === 0) return []
  const needed = Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.6)))
  return markdown(path.join(dir, "transcripts"), true)
    .flatMap((file) => {
      const text = fs.readFileSync(file, "utf8")
      const lower = text.toLowerCase()
      const counts = words.map((word) => lower.split(word).length - 1)
      const matched = counts.filter((count) => count > 0).length
      if (matched < needed) return []
      const title = text.split("\n")[0]!.replace(/^#\s*/, "").slice(0, 120)
      const titleHits = words.filter((word) => title.toLowerCase().includes(word)).length
      const score = matched * 10 + titleHits * 5 + Math.log(1 + counts.reduce((sum, count) => sum + Math.min(count, 50), 0))
      const rarest = words.filter((_, index) => counts[index]! > 0).sort((a, b) => counts[words.indexOf(a)]! - counts[words.indexOf(b)]!)[0]!
      const at = lower.indexOf(rarest)
      return [{ file, title, score, excerpt: text.slice(Math.max(0, at - 300), at + 500) }]
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => ({ file: hit.file, title: hit.title, excerpt: hit.excerpt }))
}

export function write(dir: string, entry: MemoryVault.VaultEntry) {
  const file = path.join(dir, MemoryVault.filename(entry))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, MemoryVault.toMarkdown(entry))
  return file
}

/** Removes a note by id; true when a file existed. Ids are file names, so anything with a path separator is refused. */
export function remove(dir: string, id: string) {
  if (!/^[\w.-]+$/.test(id)) return false
  const file = path.join(dir, "entries", `${id}.md`)
  if (!fs.existsSync(file)) return false
  fs.rmSync(file)
  return true
}
