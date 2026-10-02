export * as MemoryVault from "./obsidian-sync.js"

import { createHash } from "crypto"
import matter from "gray-matter"
import { parse as parseMarkdown } from "../config/markdown.js"

export type VaultEntry = {
  id: string
  kind: string
  scope: string
  title: string
  body: string
  updated: number
  source: string
}

// fork: Obsidian vault is plain markdown with frontmatter so Claude, Cursor,
// Codex, and other agents can read/write the same single source of truth.
export const filename = (entry: { id: string }) => `entries/${entry.id}.md`

export const toMarkdown = (entry: VaultEntry) =>
  matter.stringify(
    entry.body,
    { id: entry.id, kind: entry.kind, scope: entry.scope, updated: entry.updated, source: entry.source, title: entry.title },
  )

export const fromMarkdown = (id: string, raw: string): VaultEntry | undefined => {
  try {
    // fork: vault notes were written by many agents; tolerate unquoted colons
    // in frontmatter values via the shared ConfigMarkdown sanitize path.
    const parsed = parseMarkdown(raw)
    const data = parsed.data as Record<string, unknown>
    if (typeof data.id !== "string" || data.id !== id) return undefined
    if (typeof data.kind !== "string" || typeof data.scope !== "string") return undefined
    return {
      id,
      kind: data.kind,
      scope: data.scope,
      title: typeof parsed.data.title === "string" ? parsed.data.title : id,
      body: parsed.content.trim(),
      updated: typeof data.updated === "number" ? data.updated : 0,
      source: typeof data.source === "string" ? data.source : "import",
    }
  } catch {
    return undefined
  }
}

export const hashFile = (raw: string) => createHash("sha256").update(raw).digest("hex")

export type SyncState = {
  vaultDir: string
  lastSyncAt: number
  files: Record<string, string>
}

export const emptySync = (vaultDir: string): SyncState => ({ vaultDir, lastSyncAt: 0, files: {} })
