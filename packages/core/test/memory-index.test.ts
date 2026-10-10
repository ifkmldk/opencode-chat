import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryIndex } from "../src/memory/index"

const vaultDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vault-idx-"))
const write = (vault: string, rel: string, text: string) => {
  const file = path.join(vault, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

describe("MemoryIndex.chunk", () => {
  test("splits on blank lines and keeps every paragraph", () => {
    const text = Array.from({ length: 40 }, (_, i) => `paragraph ${i} ${"x".repeat(120)}`).join("\n\n")
    const parts = MemoryIndex.chunk(text)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join(" ")).toContain("paragraph 39")
    for (const part of parts) expect(part.length).toBeLessThan(2000)
  })
  test("short text is one chunk", () => {
    expect(MemoryIndex.chunk("hello world")).toEqual(["hello world"])
  })
})

describe("MemoryIndex.terms", () => {
  test("drops short words and common filler, keeps names", () => {
    const words = MemoryIndex.terms("gimana hasil interview Sirclo yang kemarin? jawab singkat")
    expect(words).toContain("sirclo")
    expect(words).toContain("interview")
    expect(words).not.toContain("yang")
    expect(words).not.toContain("gw")
  })
  test("caps the number of search terms", () => {
    const many = Array.from({ length: 40 }, (_, i) => `word${i}abc`).join(" ")
    expect(MemoryIndex.terms(many).length).toBeLessThanOrEqual(12)
  })
})

describe("MemoryIndex.build + query", () => {
  test("indexes notes and finds them by content, tags and path", () => {
    const vault = vaultDir()
    write(vault, "sessions/claude-code/a.md", "---\ntitle: Sesi Sirclo\n---\n# Sesi Sirclo\n\nInterview Sirclo hari Senin, posisi data intelligence.")
    write(vault, "entries/tagged.md", "Catatan kerja\n\n#karir/loker tentang lamaran Bandung")
    const first = MemoryIndex.build(vault)
    expect(first.files).toBe(2)
    expect(MemoryIndex.query(vault, "interview sirclo").some((hit) => hit.path.endsWith("a.md"))).toBe(true)
    expect(MemoryIndex.query(vault, "karir loker").some((hit) => hit.path.endsWith("tagged.md"))).toBe(true)
    expect(MemoryIndex.query(vault, "sessions claude-code").length).toBeGreaterThan(0)
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("unchanged vault is not re-indexed; changed and deleted files are", () => {
    const vault = vaultDir()
    write(vault, "entries/one.md", "alpha content here")
    write(vault, "entries/two.md", "beta content here")
    expect(MemoryIndex.build(vault).indexed).toBe(2)
    expect(MemoryIndex.build(vault).indexed).toBe(0)
    write(vault, "entries/one.md", "alpha changed content, longer than before to change size")
    expect(MemoryIndex.build(vault).indexed).toBe(1)
    fs.rmSync(path.join(vault, "entries/two.md"))
    MemoryIndex.build(vault)
    expect(MemoryIndex.query(vault, "beta").length).toBe(0)
    expect(MemoryIndex.query(vault, "changed").length).toBeGreaterThan(0)
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("tool-call lines are never indexed", () => {
    const vault = vaultDir()
    write(vault, "transcripts/t.md", "Pengguna\n\nbicara tentang kontrakan\n\n- tool: Bash({\"command\":\"secretword42\"})\n\n[tool result] secretword42 output")
    MemoryIndex.build(vault)
    expect(MemoryIndex.query(vault, "secretword42").length).toBe(0)
    expect(MemoryIndex.query(vault, "kontrakan").length).toBeGreaterThan(0)
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("query output is capped in size and per-file count", () => {
    const vault = vaultDir()
    for (let i = 0; i < 6; i++) write(vault, `transcripts/big${i}.md`, Array.from({ length: 30 }, () => "keyword filler text ".repeat(20)).join("\n\n"))
    MemoryIndex.build(vault)
    const hits = MemoryIndex.query(vault, "keyword", { maxChars: 8000 })
    expect(hits.reduce((n, h) => n + h.text.length, 0)).toBeLessThanOrEqual(8000)
    expect(hits.length).toBeLessThanOrEqual(5)
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("no index file means no hits and no crash", () => {
    const vault = vaultDir()
    expect(MemoryIndex.query(vault, "apapun")).toEqual([])
    fs.rmSync(vault, { recursive: true, force: true })
  })
})
