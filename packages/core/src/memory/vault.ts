export * as MemoryVaultFiles from "./vault.js"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryVault } from "./obsidian-sync.js"

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

/** Notes in `<dir>/entries`, parsed once per change of the folder (count + newest modification time). */
export function read(dir: string): MemoryVault.VaultEntry[] {
  const folder = path.join(dir, "entries")
  let names: string[]
  try {
    names = fs.readdirSync(folder).filter((name) => name.endsWith(".md"))
  } catch {
    return []
  }
  const newest = names.reduce((max, name) => {
    try {
      return Math.max(max, fs.statSync(path.join(folder, name)).mtimeMs)
    } catch {
      return max
    }
  }, 0)
  const signature = `${names.length}:${newest}`
  const hit = cache.get(dir)
  if (hit?.signature === signature) return hit.entries
  const entries = names.flatMap((name) => {
    try {
      const entry = MemoryVault.fromMarkdown(name.slice(0, -3), fs.readFileSync(path.join(folder, name), "utf8"))
      return entry ? [entry] : []
    } catch {
      return []
    }
  })
  cache.set(dir, { signature, entries })
  return entries
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
