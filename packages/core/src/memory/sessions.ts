export * as MemorySessions from "./sessions.js"

import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryVault } from "./obsidian-sync.js"
import { Secrets } from "../secrets.js"
import * as MemoryCline from "./cline.js"

const AGENT_LABEL: Record<string, string> = { opencode: "OpenCode", gemini: "Gemini", cline: "Cline", codex: "Codex", antigravity: "Antigravity" }

// fork: one big context for every agent the owner uses. Claude Code sessions (~/.claude/projects/*/*.jsonl), Claude Code
// memory notes (~/.claude/projects/*/memory/*.md) and OpenCode sessions (the server database) are copied into the Obsidian
// vault as markdown, with secrets removed first:
//   sessions/<agent>/<project>/<date>-<id>.md     a short summary (what was asked, what came out) — part of recall
//   transcripts/<agent>/<project>/<date>-<id>.md  the whole conversation (tool output trimmed) — searched on demand
//   sessions/claude-memory/<project>/<name>.md     Claude Code's own memory notes — part of recall
// The copy is incremental: a file is re-read only when its size or modification time changed.

export type Turn = { role: "user" | "assistant"; text: string; tools: string[] }
export type Parsed = { agent: "claude-code" | "opencode" | "gemini" | "cline" | "codex" | "antigravity";id: string; title: string; cwd: string; started: number; ended: number; turns: Turn[]; files: string[] }

const MAX_TOOL_INPUT = 500
const MAX_TOOL_RESULT = 2000

const NOT_ASKED = /^(\[tool result|\[Image: original|This session is being continued from a previous conversation|<task-notification>|<(command-|local-command|system-reminder)|Base directory for this skill)/

// ---------- secrets ----------

// Whole-match secrets, and "name = value" / "?key=value" forms where only the value goes.
const WHOLE: RegExp[] = [
  /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]
const VALUE: RegExp[] = [
  /((?:Bearer|Basic)\s+)[A-Za-z0-9+/=._-]{16,}/gi,
  /([?&](?:auth_token|token|access_token|api_key|key|password)=)[^&\s"'<>]+/gi,
  /("?(?:api[_-]?key|apikey|secret|password|passwd|token|access[_-]?token|auth[_-]?token|client[_-]?secret)"?\s*[:=]\s*)(?:"[^"\n]{6,}"|'[^'\n]{6,}'|[^\s,;"'}{\]]{8,})/gi,
]

/** Known secret values (environment variables with secret-looking names, the 9router key from opencode.json). */
export function knownSecrets(env: NodeJS.ProcessEnv = process.env) {
  const values = Object.entries(env)
    .filter((entry): entry is [string, string] => !!entry[1] && entry[1].length >= 8 && Secrets.isSecretName(entry[0]))
    .map((entry) => entry[1])
  const config = path.join(os.homedir(), ".config", "opencode")
  for (const name of ["opencode.json", "opencode.jsonc", "service.json", "auth.json"]) {
    try {
      const text = fs.readFileSync(path.join(config, name), "utf8")
      for (const match of text.matchAll(/"(?:apiKey|api_key|password|key|token|access|refresh)"\s*:\s*"([^"{}]{8,})"/gi)) values.push(match[1]!)
    } catch {
      // no file
    }
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length)
}

export function redact(text: string, secrets: readonly string[]) {
  const known = secrets.reduce((out, secret) => out.split(secret).join("[REDACTED]"), text)
  const whole = WHOLE.reduce((out, pattern) => out.replace(pattern, "[REDACTED]"), known)
  return VALUE.reduce((out, pattern) => out.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`), whole)
}

// ---------- Claude Code ----------

const asText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block: any) => {
      if (block?.type === "text") return String(block.text ?? "")
      if (block?.type === "tool_result") {
        const inner = typeof block.content === "string" ? block.content : asText(block.content)
        return `[tool result${block.is_error ? " (error)" : ""}] ${trim(inner, MAX_TOOL_RESULT)}`
      }
      if (block?.type === "image") return "[image]"
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

const trim = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text)

/** Claude Code session file (one JSON record per line) to a conversation. Sub-agent (sidechain) records are left out. */
export function parseClaude(raw: string, fallbackID: string, options: { sidechain?: boolean } = {}): Parsed | undefined {
  const turns: Turn[] = []
  const files = new Set<string>()
  let title = ""
  let cwd = ""
  let started = 0
  let ended = 0
  let id = fallbackID
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type === "custom-title" && record.customTitle) title = String(record.customTitle)
    if (record.type === "ai-title" && record.aiTitle && !title) title = String(record.aiTitle)
    if (record.type !== "user" && record.type !== "assistant") continue
    if (record.isSidechain && !options.sidechain) continue
    if (record.sessionId) id = String(record.sessionId)
    if (record.cwd && !cwd) cwd = String(record.cwd)
    const at = Date.parse(record.timestamp ?? "")
    if (Number.isFinite(at)) {
      started = started || at
      ended = Math.max(ended, at)
    }
    const content = record.message?.content
    if (record.type === "user") {
      const text = asText(content).trim()
      if (!text || /^<(command-|local-command|system-reminder)/.test(text)) continue
      const previous = turns.at(-1)
      if (previous?.role === "user" && text.startsWith("[tool result")) previous.text += `\n${text}`
      else turns.push({ role: "user", text, tools: [] })
      continue
    }
    const blocks = Array.isArray(content) ? content : []
    const text = blocks.filter((block: any) => block?.type === "text").map((block: any) => String(block.text ?? "")).join("\n").trim()
    const tools = blocks
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any) => {
        const input = block.input ?? {}
        for (const key of ["file_path", "path", "notebook_path"]) if (typeof input[key] === "string") files.add(input[key])
        return `${block.name}(${trim(JSON.stringify(input), MAX_TOOL_INPUT)})`
      })
    if (!text && tools.length === 0) continue
    const previous = turns.at(-1)
    if (previous?.role === "assistant") {
      if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text
      previous.tools.push(...tools)
    } else turns.push({ role: "assistant", text, tools })
  }
  if (!turns.some((turn) => turn.role === "user")) return undefined
  const firstAsk = turns.find((turn) => turn.role === "user" && !turn.text.startsWith("[tool result"))?.text ?? ""
  return { agent: "claude-code", id, title: title || firstAsk.split("\n")[0]!.slice(0, 80), cwd, started, ended, turns, files: [...files].slice(0, 40) }
}

// ---------- OpenCode ----------

const pushAssistant = (turns: Turn[], text: string, tools: string[]) => {
  if (!text && tools.length === 0) return
  const previous = turns.at(-1)
  if (previous?.role === "assistant") {
    if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text
    previous.tools.push(...tools)
    return
  }
  turns.push({ role: "assistant", text, tools })
}

const toolLine = (name: string, input: Record<string, unknown>, output: string, files: Set<string>) => {
  for (const key of ["filePath", "path", "file"]) if (typeof input[key] === "string") files.add(input[key] as string)
  return `${name}(${trim(JSON.stringify(input), MAX_TOOL_INPUT)})${output ? ` → ${trim(output, MAX_TOOL_RESULT)}` : ""}`
}

const cleanUser = (text: string) => text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()

/** OpenCode sessions changed since `since` (ms), read-only. Reads both layouts: v2 (session_v2 + session_message) and v1 (session + message + part). */
export function readOpenCode(dbPath: string, since: number): Parsed[] {
  if (!fs.existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const tables = new Set((db.query("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
    return [...(tables.has("session_v2") && tables.has("session_message") ? readV2(db, since) : []), ...(tables.has("session") && tables.has("part") ? readV1(db, since) : [])]
  } finally {
    db.close()
  }
}

function readV2(db: Database, since: number): Parsed[] {
  const sessions = db
    .query("select id, title, directory, time_created, time_updated from session_v2 where parent_id is null and time_updated > ? order by time_updated")
    .all(since) as Array<{ id: string; title: string; directory: string; time_created: number; time_updated: number }>
  const messages = db.query("select type, data from session_message where session_id = ? order by seq")
  return sessions.flatMap((session) => {
    const turns: Turn[] = []
    const files = new Set<string>()
    for (const row of messages.all(session.id) as Array<{ type: string; data: string }>) {
      if (row.type !== "user" && row.type !== "assistant") continue
      let data: any
      try {
        data = JSON.parse(row.data)
      } catch {
        continue
      }
      if (row.type === "user") {
        const text = cleanUser(String(data.metadata?.displayText ?? data.text ?? asText(data.content ?? [])))
        if (text) turns.push({ role: "user", text, tools: [] })
        continue
      }
      const parts = Array.isArray(data.content) ? data.content : []
      const text = parts.filter((part: any) => part?.type === "text").map((part: any) => String(part.text ?? "")).join("\n").replace(/\[\[OPENCODE_TASK_COMPLETE\]\]/g, "").trim()
      const tools = parts
        .filter((part: any) => part?.type === "tool")
        .map((part: any) => toolLine(String(part.name), part.state?.input ?? {}, (part.state?.content ?? []).filter((item: any) => item?.type === "text").map((item: any) => item.text).join("\n"), files))
      pushAssistant(turns, text, tools)
    }
    if (!turns.some((turn) => turn.role === "user")) return []
    return [{ agent: "opencode" as const, id: session.id, title: session.title || "", cwd: session.directory, started: session.time_created, ended: session.time_updated, turns, files: [...files].slice(0, 40) }]
  })
}

function readV1(db: Database, since: number): Parsed[] {
  const sessions = db
    .query("select id, title, directory, time_created, time_updated from session where parent_id is null and time_updated > ? order by time_updated")
    .all(since) as Array<{ id: string; title: string; directory: string; time_created: number; time_updated: number }>
  const messages = db.query("select id, data from message where session_id = ? order by time_created")
  const parts = db.query("select data from part where message_id = ? order by time_created")
  return sessions.flatMap((session) => {
    const turns: Turn[] = []
    const files = new Set<string>()
    for (const message of messages.all(session.id) as Array<{ id: string; data: string }>) {
      let info: any
      try {
        info = JSON.parse(message.data)
      } catch {
        continue
      }
      const items = (parts.all(message.id) as Array<{ data: string }>).flatMap((row) => {
        try {
          return [JSON.parse(row.data)]
        } catch {
          return []
        }
      })
      const text = items.filter((part) => part?.type === "text" && !part.synthetic).map((part) => String(part.text ?? "")).join("\n").trim()
      if (info.role === "user") {
        if (cleanUser(text)) turns.push({ role: "user", text: cleanUser(text), tools: [] })
        continue
      }
      const tools = items.filter((part) => part?.type === "tool").map((part) => toolLine(String(part.tool), part.state?.input ?? {}, String(part.state?.output ?? ""), files))
      pushAssistant(turns, text, tools)
    }
    if (!turns.some((turn) => turn.role === "user")) return []
    return [{ agent: "opencode" as const, id: session.id, title: session.title || "", cwd: session.directory, started: session.time_created, ended: session.time_updated, turns, files: [...files].slice(0, 40) }]
  })
}

// ---------- markdown ----------

const day = (ms: number) => new Date(ms || Date.now()).toISOString().slice(0, 10)
export const project = (cwd: string) => (cwd ? path.basename(cwd.replace(/[\\/]+$/, "")) : "unknown").replace(/[^\w.-]+/g, "-").slice(0, 60) || "unknown"
export const noteID = (session: Parsed) => `${session.agent}-${day(session.started)}-${session.id.replace(/[^\w-]/g, "").slice(-12)}`

/** Summary note: what the user asked (every request, shortened) and the last answer. Shaped as a vault entry so recall reads it. */
export function summary(session: Parsed, secrets: readonly string[]): MemoryVault.VaultEntry {
  // What the person typed, not what the app injected (resumed-context summaries, task notifications, loaded skill text).
  const asks = session.turns
    .filter((turn) => turn.role === "user" && !NOT_ASKED.test(turn.text) && !(turn.text.startsWith("# ") && turn.text.length > 2000))
    .map((turn) => ({ ...turn, text: turn.text.replace(/\[Image: source:[^\]]*\]/g, "").replace(/(\[image\]\s*)+/g, "[gambar] ").trim() }))
    .filter((turn) => turn.text.length > 0)
  const answers = session.turns.filter((turn) => turn.role === "assistant" && turn.text)
  const body = [
    `Agent: ${session.agent} · Proyek: ${session.cwd || "-"} · ${day(session.started)} → ${day(session.ended)}`,
    "",
    "## Permintaan",
    ...asks.slice(0, 25).map((turn) => `- ${trim(turn.text.replace(/\s+/g, " "), 400)}`),
    ...(asks.length > 25 ? [`- … ${asks.length - 25} permintaan lain (lihat transkrip)`] : []),
    "",
    "## Hasil terakhir",
    trim(answers.at(-1)?.text ?? "-", 2500),
    ...(session.files.length ? ["", "## File yang disentuh", ...session.files.map((file) => `- ${file}`)] : []),
    "",
    `Transkrip lengkap: transcripts/${session.agent}/${project(session.cwd)}/${noteID(session)}.md`,
  ].join("\n")
  return {
    id: noteID(session),
    kind: "session",
    scope: project(session.cwd),
    title: redact(`Sesi ${AGENT_LABEL[session.agent] ?? "Claude Code"}:${session.title || "(tanpa judul)"}`, secrets),
    body: redact(body, secrets),
    updated: session.ended || Date.now(),
    source: session.agent,
  }
}

export function transcript(session: Parsed, secrets: readonly string[]) {
  const lines = [
    `# ${session.title || "(tanpa judul)"}`,
    "",
    `Agent: ${session.agent} · Sesi: ${session.id} · Proyek: ${session.cwd || "-"} · ${new Date(session.started || Date.now()).toISOString()} → ${new Date(session.ended || Date.now()).toISOString()}`,
    "",
    ...session.turns.flatMap((turn) => [
      `## ${turn.role === "user" ? "Pengguna" : "Asisten"}`,
      "",
      turn.text,
      ...(turn.tools.length ? ["", ...turn.tools.map((tool) => `- tool: ${tool}`)] : []),
      "",
    ]),
  ]
  return redact(lines.join("\n"), secrets)
}

// ---------- sync ----------

type State = { files: Record<string, string>; since: Record<string, number> }

const readState = (file: string): State => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>
    return { files: parsed.files ?? {}, since: parsed.since ?? {} }
  } catch {
    return { files: {}, since: {} }
  }
}

export const writeNote = (vault: string, session: Parsed, secrets: readonly string[]) => {
  const entry = summary(session, secrets)
  const summaryFile = path.join(vault, "sessions", session.agent, project(session.cwd), `${entry.id}.md`)
  const transcriptFile = path.join(vault, "transcripts", session.agent, project(session.cwd), `${entry.id}.md`)
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true })
  fs.mkdirSync(path.dirname(transcriptFile), { recursive: true })
  fs.writeFileSync(summaryFile, MemoryVault.toMarkdown(entry))
  fs.writeFileSync(transcriptFile, transcript(session, secrets))
}

const signatureOf = (file: string) => {
  const stat = fs.statSync(file)
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`
}

const jsonlUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return jsonlUnder(file)
    return entry.name.endsWith(".jsonl") ? [file] : []
  })

/** The OpenCode databases next to the active one (older channels and versions keep their own file). */
export function opencodeDatabases(dataDir = path.join(os.homedir(), ".local", "share", "opencode")) {
  try {
    return fs
      .readdirSync(dataDir)
      .filter((name) => /^opencode(-[\w.-]+)?\.db$/.test(name))
      .map((name) => path.join(dataDir, name))
  } catch {
    return []
  }
}

export type Options = { vault: string; claudeDir?: string; opencodeDBs?: readonly string[]; clineDir?: string; secrets?: readonly string[]; limit?: number }
export type Result = { claude: number; subagents: number; claudeMemory: number; opencode: number; cline: number; skipped: number; errors: string[] }

/** Copies new or changed sessions into the vault. Safe to run often: unchanged files are skipped. */
export function sync(options: Options): Result {
  const secrets = options.secrets ?? knownSecrets()
  const stateFile = path.join(options.vault, ".sync", "sessions.json")
  const state = readState(stateFile)
  const result: Result = { claude: 0, subagents: 0, claudeMemory: 0, opencode: 0, cline: 0, skipped: 0, errors: [] }
  const claudeDir = options.claudeDir ?? path.join(os.homedir(), ".claude", "projects")
  const budget = { left: options.limit ?? Number.POSITIVE_INFINITY }
  const projects = fs.existsSync(claudeDir) ? fs.readdirSync(claudeDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : []
  for (const folder of projects) {
    const dir = path.join(claudeDir, folder.name)
    for (const file of jsonlUnder(dir)) {
      if (budget.left <= 0) break
      const signature = signatureOf(file)
      if (state.files[file] === signature) {
        result.skipped++
        continue
      }
      const nested = path.dirname(file) !== dir
      try {
        const parsed = parseClaude(fs.readFileSync(file, "utf8"), path.basename(file, ".jsonl"), { sidechain: nested })
        if (parsed && nested) {
          // A sub-agent's own conversation: kept as a transcript under its parent session, not as a recall note.
          const parent = path.relative(dir, file).split(path.sep)[0] ?? "session"
          const target = path.join(options.vault, "transcripts", "claude-code", project(folder.name), "subagents", `${parent.slice(0, 12)}-${path.basename(file, ".jsonl")}.md`)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, transcript(parsed, secrets))
          result.subagents++
        }
        if (parsed && !nested) {
          writeNote(options.vault, parsed, secrets)
          result.claude++
        }
        if (parsed) budget.left--
        state.files[file] = signature
      } catch (error) {
        result.errors.push(`${path.basename(file)}: ${(error as Error).message}`.slice(0, 200))
      }
    }
    const memoryDir = path.join(dir, "memory")
    if (!fs.existsSync(memoryDir)) continue
    for (const name of fs.readdirSync(memoryDir).filter((file) => file.endsWith(".md") && file !== "MEMORY.md")) {
      const file = path.join(memoryDir, name)
      const signature = signatureOf(file)
      if (state.files[file] === signature) continue
      const raw = fs.readFileSync(file, "utf8")
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim()
      const title = raw.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "") ?? name.slice(0, -3)
      const scope = project(folder.name)
      const entry: MemoryVault.VaultEntry = {
        id: `claude-memory-${scope}-${name.slice(0, -3)}`.replace(/[^\w.-]+/g, "-").slice(0, 120),
        kind: "fact",
        scope,
        title: redact(`Memory Claude: ${title}`, secrets),
        body: redact(body, secrets),
        updated: fs.statSync(file).mtimeMs,
        source: "claude-memory",
      }
      const target = path.join(options.vault, "sessions", "claude-memory", scope, `${entry.id}.md`)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, MemoryVault.toMarkdown(entry))
      state.files[file] = signature
      result.claudeMemory++
    }
  }
  // fork: Cline sessions, re-read only when their messages file changed.
  const clineRoot = options.clineDir ?? path.join(os.homedir(), ".cline", "data", "sessions")
  for (const { dir, id } of MemoryCline.sessionsUnder(clineRoot)) {
    const file = path.join(dir, `${id}.messages.json`)
    if (!fs.existsSync(file)) continue
    const signature = signatureOf(file)
    if (state.files[file] === signature) {
      result.skipped++
      continue
    }
    try {
      const parsed = MemoryCline.parse(dir, id)
      if (parsed) {
        writeNote(options.vault, parsed, secrets)
        result.cline++
      }
      state.files[file] = signature
    } catch (error) {
      result.errors.push(`cline ${id}: ${(error as Error).message}`.slice(0, 200))
    }
  }
  for (const db of options.opencodeDBs ?? []) {
    try {
      for (const session of readOpenCode(db, state.since[db] ?? 0)) {
        writeNote(options.vault, session, secrets)
        result.opencode++
        state.since[db] = Math.max(state.since[db] ?? 0, session.ended)
      }
    } catch (error) {
      result.errors.push(`${path.basename(db)}: ${(error as Error).message}`.slice(0, 200))
    }
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state))
  return result
}
