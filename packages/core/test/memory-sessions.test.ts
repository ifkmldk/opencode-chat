import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemorySessions } from "../src/memory/sessions"

const SENTINEL = "TESTSENTINEL-9ROUTER-abcdef123456"

describe("redact", () => {
  test("removes known values and common key shapes, keeps the text around them", () => {
    const text = [
      `key ${SENTINEL} here`,
      "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "http://127.0.0.1:4096/?auth_token=b3BlbmNvZGU6c2VjcmV0",
      '"apiKey": "1234567890abcdef"',
      "password=hunter2hunter2",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    ].join("\n")
    const out = MemorySessions.redact(text, [SENTINEL])
    expect(out).not.toContain(SENTINEL)
    expect(out).not.toContain("sk-proj-AAAA")
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345")
    expect(out).not.toContain("b3BlbmNvZGU6c2VjcmV0")
    expect(out).not.toContain("1234567890abcdef")
    expect(out).not.toContain("hunter2hunter2")
    expect(out).not.toContain("ghp_ABCDEF")
    expect(out).toContain("Authorization: Bearer [REDACTED]")
    expect(out).toContain("auth_token=[REDACTED]")
    expect(out).toContain("key [REDACTED] here")
  })
})

const claudeLines = (sessionId: string) =>
  [
    { type: "custom-title", customTitle: "Loker Bandung", sessionId },
    { type: "user", sessionId, cwd: "C:/Users/me/proj", timestamp: "2026-10-05T01:00:00Z", message: { content: "carikan loker data analyst bandung" } },
    { type: "assistant", sessionId, timestamp: "2026-10-05T01:00:05Z", message: { content: [{ type: "thinking", thinking: "secret plan" }, { type: "text", text: "Saya cari dulu." }, { type: "tool_use", name: "Read", input: { file_path: "C:/proj/a.ts" } }] } },
    { type: "user", sessionId, timestamp: "2026-10-05T01:00:06Z", message: { content: [{ type: "tool_result", tool_use_id: "x", content: `file text ${SENTINEL}` }] } },
    { type: "assistant", sessionId, timestamp: "2026-10-05T01:01:00Z", message: { content: [{ type: "text", text: "Ketemu 20 loker." }] } },
    { type: "user", isSidechain: true, sessionId, message: { content: "subagent prompt" } },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")

describe("Claude Code sessions", () => {
  test("parses asks, answers, tools and files; leaves out thinking and sub-agents", () => {
    const parsed = MemorySessions.parseClaude(claudeLines("abc-123"), "fallback")!
    expect(parsed.title).toBe("Loker Bandung")
    expect(parsed.turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(parsed.files).toEqual(["C:/proj/a.ts"])
    const transcript = MemorySessions.transcript(parsed, [SENTINEL])
    expect(transcript).not.toContain("secret plan")
    expect(transcript).not.toContain("subagent prompt")
    expect(transcript).not.toContain(SENTINEL)
    expect(transcript).toContain("Ketemu 20 loker.")
    const note = MemorySessions.summary(parsed, [])
    expect(note).toMatchObject({ kind: "session", scope: "proj", source: "claude-code" })
    expect(note.body).toContain("carikan loker data analyst bandung")
    expect(note.body).toContain("Ketemu 20 loker.")
  })

  test("sync writes summary, transcript and Claude memory notes once, without secrets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-sync-"))
    const claude = path.join(root, "claude", "C--Users-me-proj")
    fs.mkdirSync(path.join(claude, "memory"), { recursive: true })
    fs.writeFileSync(path.join(claude, "abc-123.jsonl"), claudeLines("abc-123"))
    fs.writeFileSync(path.join(claude, "memory", "rule.md"), `---\nname: rule\ndescription: Never deploy on Fridays\n---\nDeploy only Mon-Thu. Key ${SENTINEL}\n`)
    const vault = path.join(root, "vault")
    const first = MemorySessions.sync({ vault, claudeDir: path.join(root, "claude"), secrets: [SENTINEL] })
    expect(first).toMatchObject({ claude: 1, claudeMemory: 1, errors: [] })
    const second = MemorySessions.sync({ vault, claudeDir: path.join(root, "claude"), secrets: [SENTINEL] })
    expect(second).toMatchObject({ claude: 0, claudeMemory: 0, skipped: 1 })
    const all = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? all(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
    const files = all(vault).filter((file) => file.endsWith(".md"))
    expect(files.some((file) => file.includes(path.join("sessions", "claude-code")))).toBe(true)
    expect(files.some((file) => file.includes(path.join("transcripts", "claude-code")))).toBe(true)
    expect(files.some((file) => file.includes(path.join("sessions", "claude-memory")))).toBe(true)
    expect(files.map((file) => fs.readFileSync(file, "utf8")).join("\n")).not.toContain(SENTINEL)
  })
})

test("the summary lists what the person asked, not text the app injected", () => {
  const lines = [
    { type: "user", sessionId: "s1", cwd: "C:/p", timestamp: "2026-10-05T01:00:00Z", message: { content: "This session is being continued from a previous conversation that ran out of context. Summary: ..." } },
    { type: "user", sessionId: "s1", timestamp: "2026-10-05T01:00:01Z", message: { content: "<task-notification><task-id>x</task-id></task-notification>" } },
    { type: "user", sessionId: "s1", timestamp: "2026-10-05T01:00:02Z", message: { content: "deploy fork.12 dong" } },
    { type: "assistant", sessionId: "s1", timestamp: "2026-10-05T01:00:03Z", message: { content: [{ type: "text", text: "Sudah." }] } },
  ].map((record) => JSON.stringify(record)).join("\n")
  const note = MemorySessions.summary(MemorySessions.parseClaude(lines, "s1")!, [])
  expect(note.body).toContain("- deploy fork.12 dong")
  expect(note.body).not.toContain("This session is being continued")
  expect(note.body).not.toContain("task-notification")
})
