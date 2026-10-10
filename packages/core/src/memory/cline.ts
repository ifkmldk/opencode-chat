export * as MemoryCline from "./cline.js"

import fs from "node:fs"
import path from "node:path"
import type { Parsed, Turn } from "./sessions.js"

// fork: Cline sessions (~/.cline/data/sessions/<id>/<id>.messages.json, metadata in <id>.json). Read as Parsed so the same
// summary and transcript writers as Claude Code and OpenCode apply. Thinking blocks are left out; tool calls keep their input,
// tool results are trimmed.

const MAX_TOOL_INPUT = 500
const MAX_TOOL_RESULT = 2000
const trim = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text)

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((block: any) => (block?.type === "text" ? String(block.text ?? "") : block?.type === "image" ? "[image]" : "")).filter(Boolean).join("\n")
}

/** One Cline session folder to a conversation; undefined when it has no user message. */
export function parse(dir: string, id: string): Parsed | undefined {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as Record<string, any>
  const file = path.join(dir, `${id}.messages.json`)
  if (!fs.existsSync(file)) return undefined
  const messages = (JSON.parse(fs.readFileSync(file, "utf8")).messages ?? []) as Array<{ role: string; content: unknown; ts?: number }>
  const turns: Turn[] = []
  const files = new Set<string>()
  for (const message of messages) {
    const blocks: any[] = Array.isArray(message.content) ? message.content : [{ type: "text", text: String(message.content ?? "") }]
    if (message.role === "user") {
      const text = blocks.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n").trim()
      const results = blocks.filter((block) => block?.type === "tool_result").map((block) => `[tool result${block.is_error ? " (error)" : ""}] ${trim(resultText(block.content), MAX_TOOL_RESULT)}`)
      if (text) turns.push({ role: "user", text, tools: [] })
      else if (results.length) {
        const previous = turns.at(-1)
        if (previous?.role === "user") previous.text += `\n${results.join("\n")}`
        else turns.push({ role: "user", text: results.join("\n"), tools: [] })
      }
      continue
    }
    if (message.role !== "assistant") continue
    const text = blocks.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n").trim()
    const tools = blocks
      .filter((block) => block?.type === "tool_use")
      .map((block) => {
        const input = (block.input ?? {}) as Record<string, unknown>
        for (const key of ["path", "file_path", "absolutePath"]) if (typeof input[key] === "string") files.add(input[key] as string)
        return `${block.name}(${trim(JSON.stringify(input), MAX_TOOL_INPUT)})`
      })
    if (!text && !tools.length) continue
    const previous = turns.at(-1)
    if (previous?.role === "assistant") {
      if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text
      previous.tools.push(...tools)
    } else turns.push({ role: "assistant", text, tools })
  }
  if (!turns.some((turn) => turn.role === "user")) return undefined
  const started = Date.parse(meta.started_at ?? "") || messages[0]?.ts || 0
  const ended = Date.parse(meta.ended_at ?? "") || messages.at(-1)?.ts || started
  const title = String(meta.prompt ?? turns[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 80)
  return { agent: "cline", id, title, cwd: String(meta.cwd ?? meta.workspace_root ?? ""), started, ended, turns, files: [...files].slice(0, 40) }
}

/** Every Cline session folder under `root` whose messages file changed since its recorded signature. */
export function sessionsUnder(root: string) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({ dir: path.join(root, entry.name), id: entry.name }))
}
