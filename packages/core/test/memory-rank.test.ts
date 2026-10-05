import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryRank } from "../src/memory/rank"
import { MemoryVaultFiles } from "../src/memory/vault"

const note = (id: string, kind: string, title: string, body: string) => ({ id, kind, scope: "global", title, body })

describe("MemoryRank", () => {
  const notes = [
    note("1", "preference", "Lokasi kerja: hanya Tangerang", "Saya hanya mau lowongan di Tangerang dan Tangerang Selatan, bukan Jakarta."),
    note("2", "correction", "Jangan tampilkan lowongan yang sudah dilamar", "Lowongan yang sudah saya lamar tidak boleh muncul lagi di hasil pencarian."),
    note("3", "fact", "Stack data", "Saya memakai SQL, Python, Power BI dan dbt untuk pekerjaan analis data."),
    note("4", "decision", "Keputusan: Kerja\Portfolio\TODO.", "Kerja\Portfolio\TODO."),
    note("5", "preference", "Gaya jawaban", "Jawab singkat dalam bahasa Indonesia dengan tabel."),
  ]

  test("returns the notes that fit a natural question and nothing else", () => {
    const found = MemoryRank.rank("cariin lowongan data analyst di Tangerang yang belum saya lamar", notes, { minScore: 3 })
    expect(found.map((entry) => entry.id)).toContain("1")
    expect(found.map((entry) => entry.id)).toContain("2")
    expect(found.map((entry) => entry.id)).not.toContain("4")
  })

  test("is silent for an unrelated question", () => {
    expect(MemoryRank.rank("resep nasi goreng pedas untuk empat orang", notes)).toEqual([])
    expect(MemoryRank.rank("ok", notes)).toEqual([])
  })

  test("one weak word match is not enough", () => {
    expect(MemoryRank.rank("tampilkan kalender bulan depan", notes)).toEqual([])
  })

  test("drops noise notes and duplicates", () => {
    const dup = [...notes, note("6", "preference", "Gaya jawaban", "Jawab singkat dalam bahasa Indonesia dengan tabel.")]
    const found = MemoryRank.rank("tolong jawab singkat dengan tabel bahasa Indonesia", dup)
    expect(found.filter((entry) => entry.title === "Gaya jawaban")).toHaveLength(1)
    expect(MemoryRank.isNoise(notes[3]!)).toBe(true)
  })

  test("block is empty with no notes and bounded otherwise", () => {
    expect(MemoryRank.block([])).toBe("")
    const text = MemoryRank.block(notes.slice(0, 3))
    expect(text).toContain("<memory>")
    expect(text.length).toBeLessThan(1700)
  })
})

describe("MemoryVaultFiles", () => {
  const make = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"))
    fs.mkdirSync(path.join(dir, "entries"))
    return dir
  }

  test("writes a note, reads it back, and removes it by id only", () => {
    const dir = make()
    try {
      MemoryVaultFiles.write(dir, { id: "abc123", kind: "preference", scope: "global", title: "Bahasa", body: "Jawab dalam bahasa Indonesia.", updated: 1, source: "agent" })
      const read = MemoryVaultFiles.read(dir)
      expect(read).toHaveLength(1)
      expect(read[0]).toMatchObject({ id: "abc123", kind: "preference", title: "Bahasa", body: "Jawab dalam bahasa Indonesia." })
      expect(MemoryVaultFiles.remove(dir, "../entries/abc123")).toBe(false)
      expect(MemoryVaultFiles.remove(dir, "missing")).toBe(false)
      expect(MemoryVaultFiles.remove(dir, "abc123")).toBe(true)
      expect(MemoryVaultFiles.read(dir)).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("settings: env path wins, a missing folder disables the vault, write can be turned off", () => {
    const dir = make()
    const config = fs.mkdtempSync(path.join(os.tmpdir(), "vault-config-"))
    try {
      expect(MemoryVaultFiles.settings(config, { OPENCODE_MEMORY_VAULT: dir })).toEqual({ dir, write: true })
      expect(MemoryVaultFiles.settings(config, { OPENCODE_MEMORY_VAULT: path.join(dir, "nope") }).dir).toBeUndefined()
      fs.writeFileSync(path.join(config, "memory.json"), JSON.stringify({ vaultDir: dir, write: false }))
      expect(MemoryVaultFiles.settings(config, {})).toEqual({ dir, write: false })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(config, { recursive: true, force: true })
    }
  })
})
