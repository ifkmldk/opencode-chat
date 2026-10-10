export * as MemoryGemini from "./gemini.js"

import fs from "node:fs"
import path from "node:path"
import { MemoryVault } from "./obsidian-sync.js"
import { redact, summary, transcript, project, knownSecrets, type Parsed, type Turn } from "./sessions.js"

// fork: Google Takeout "My Activity > Gemini Apps" (MyActivity.json, one entry per prompt) into the vault as one session per
// Gemini chat (grouped by the gemini.google.com/app/<id> link), same layout as the other agents:
//   sessions/gemini/Gemini/<date>-<id>.md and transcripts/gemini/Gemini/<date>-<id>.md
// Takeout exports may split by date range, so every export under the folder is merged before writing.

type Entry = { title?: string; time?: string; details?: Array<{ url?: string }>; safeHtmlItem?: Array<{ html?: string }>; attachedFiles?: string[] }

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " }

/** Gemini's answer HTML to plain markdown-ish text. */
export function htmlToText(html: string) {
  return html
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => `\n\`\`\`\n${code.replace(/<[^>]+>/g, "")}\n\`\`\`\n`)
    .replace(/<h[1-6][^>]*>/gi, "\n### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|table)>|<br\s*\/?>|<hr\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<code[^>]*>|<\/code>/gi, "`")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const PREFIX = /^(Prompted|Created|Used|Asked|Sent)\s+/

/** One or more MyActivity.json files to sessions: one per chat link, entries without a link grouped per day. */
export function parse(exports: readonly Entry[][]): Parsed[] {
  const seen = new Set<string>()
  const groups = new Map<string, Array<{ at: number; entry: Entry }>>()
  for (const entry of exports.flat()) {
    const title = entry.title ?? ""
    if (/^(Cleared|Gave|Selected|Turned)\b/.test(title)) continue
    const at = Date.parse(entry.time ?? "")
    if (!Number.isFinite(at)) continue
    const key = `${at}|${title}`
    if (seen.has(key)) continue
    seen.add(key)
    const url = entry.details?.find((detail) => detail.url?.includes("/app/"))?.url
    const id = url ? url.split("/").pop()! : `nochat-${new Date(at).toISOString().slice(0, 10)}`
    groups.set(id, [...(groups.get(id) ?? []), { at, entry }])
  }
  return [...groups].flatMap(([id, items]) => {
    items.sort((a, b) => a.at - b.at)
    const turns: Turn[] = items.flatMap(({ entry }) => {
      const ask = (entry.title ?? "").replace(PREFIX, "").trim()
      const files = entry.attachedFiles?.length ? ` [lampiran: ${entry.attachedFiles.join(", ")}]` : ""
      const answer = htmlToText((entry.safeHtmlItem ?? []).map((item) => item.html ?? "").join("\n"))
      return [{ role: "user" as const, text: `${ask}${files}`, tools: [] }, ...(answer ? [{ role: "assistant" as const, text: answer, tools: [] }] : [])]
    })
    if (!turns.length) return []
    return [{ agent: "gemini" as const, id, title: turns[0]!.text.replace(/\s+/g, " ").slice(0, 80), cwd: "Gemini", started: items[0]!.at, ended: items.at(-1)!.at, turns, files: [] }]
  })
}

/** MyActivity.json from the extracted Takeout folders and from every takeout-*.zip under `dir` (read with tar, no extraction). */
export function readExports(dir: string): { entries: Entry[][]; sources: string[]; errors: string[] } {
  const entries: Entry[][] = []
  const sources: string[] = []
  const errors: string[] = []
  const member = "Takeout/My Activity/Gemini Apps/MyActivity.json"
  const direct = path.join(dir, "Takeout", ...member.split("/").slice(1))
  const add = (name: string, text: string) => {
    try {
      entries.push(JSON.parse(text) as Entry[])
      sources.push(name)
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`.slice(0, 200))
    }
  }
  if (fs.existsSync(direct)) add(direct, fs.readFileSync(direct, "utf8"))
  for (const zip of fs.readdirSync(dir).filter((name) => /^takeout-.*\.zip$/i.test(name))) {
    const out = Bun.spawnSync([process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe") : "tar", "-xOf", path.join(dir, zip), member], { stdout: "pipe", stderr: "pipe", maxBuffer: 256 * 1024 * 1024 })
    if (out.exitCode === 0 && out.stdout.length) add(zip, out.stdout.toString("utf8"))
  }
  return { entries, sources, errors }
}

export function importTo(vault: string, dir: string) {
  const secrets = knownSecrets()
  const { entries, sources, errors } = readExports(dir)
  const sessions = parse(entries)
  for (const session of sessions) {
    const entry = summary(session, secrets)
    const dirs = ["sessions", "transcripts"].map((root) => path.join(vault, root, session.agent, project(session.cwd)))
    for (const target of dirs) fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(dirs[0]!, `${entry.id}.md`), MemoryVault.toMarkdown(entry))
    fs.writeFileSync(path.join(dirs[1]!, `${entry.id}.md`), transcript(session, secrets))
  }
  return { sessions: sessions.length, turns: sessions.reduce((sum, s) => sum + s.turns.length, 0), sources, errors, redact }
}
