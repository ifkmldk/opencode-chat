import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryDigest } from "../src/memory/digest"

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "digest-"))

describe("MemoryDigest", () => {
  test("write replaces only the marked block and keeps the rest of the file", () => {
    const dir = tmp()
    const file = path.join(dir, "AGENTS.md")
    fs.writeFileSync(file, "# Aturan saya\n\nJangan ubah ini.\n")
    const first = `${MemoryDigest.START}\nversi 1\n${MemoryDigest.END}`
    expect(MemoryDigest.write(file, first)).toBe(true)
    const second = `${MemoryDigest.START}\nversi 2\n${MemoryDigest.END}`
    expect(MemoryDigest.write(file, second)).toBe(true)
    const text = fs.readFileSync(file, "utf8")
    expect(text).toContain("Jangan ubah ini.")
    expect(text).toContain("versi 2")
    expect(text).not.toContain("versi 1")
    expect(text.split(MemoryDigest.START).length - 1).toBe(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("write reports no change when the block is identical", () => {
    const dir = tmp()
    const file = path.join(dir, "AGENTS.md")
    const block = `${MemoryDigest.START}\nsama\n${MemoryDigest.END}`
    MemoryDigest.write(file, block)
    expect(MemoryDigest.write(file, block)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("build lists recent sessions and entries, drops noise and duplicates", () => {
    const vault = tmp()
    fs.mkdirSync(path.join(vault, "sessions/claude-code/p"), { recursive: true })
    fs.mkdirSync(path.join(vault, "entries"), { recursive: true })
    const session = (title: string, request: string, updated: number) =>
      `---\nid: x\nkind: session\nupdated: ${updated}\nsource: claude-code\ntitle: '${title}'\n---\nAgent: claude-code\n\n## Permintaan\n- ${request}\n`
    fs.writeFileSync(path.join(vault, "sessions/claude-code/p/a.md"), session("Sesi Claude Code: Sirclo", "interview sirclo besok", 2000))
    fs.writeFileSync(path.join(vault, "sessions/claude-code/p/b.md"), session("Sesi Claude Code: Sirclo", "interview sirclo besok", 1000))
    fs.writeFileSync(path.join(vault, "sessions/claude-code/p/c.md"), session("Sesi Claude Code: noise", "<system-reminder>ignore me</system-reminder>", 3000))
    fs.writeFileSync(path.join(vault, "entries/e1.md"), `---\nid: e1\nkind: decision\nupdated: 1\nsource: import\ntitle: 'Keputusan: pakai Tangerang'\n---\nisi\n`)
    const block = MemoryDigest.build(vault)
    expect(block.startsWith(MemoryDigest.START)).toBe(true)
    expect(block.endsWith(MemoryDigest.END)).toBe(true)
    expect(block).toContain("interview sirclo besok")
    expect(block).not.toContain("<system-reminder")
    expect(block.split("interview sirclo besok").length - 1).toBe(1)
    expect(block).toContain("Keputusan: pakai Tangerang")
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("build stays under its byte budget", () => {
    const vault = tmp()
    fs.mkdirSync(path.join(vault, "entries"), { recursive: true })
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(vault, `entries/n${i}.md`), `---\nupdated: ${i}\ntitle: 'Catatan ${i} ${"panjang ".repeat(30)}'\n---\nisi\n`)
    expect(Buffer.byteLength(MemoryDigest.build(vault, 4000), "utf8")).toBeLessThanOrEqual(4000)
    fs.rmSync(vault, { recursive: true, force: true })
  })

  test("targets only include agents whose folder already exists", () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
    const agents = MemoryDigest.targets(home).map((t) => t.agent)
    expect(agents).toContain("codex")
    expect(agents).not.toContain("opencode")
    fs.rmSync(home, { recursive: true, force: true })
  })
})
