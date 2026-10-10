import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { MemoryIndex } from "../src/memory/index"
import { MemoryRerank } from "../src/memory/rerank"

// A fake reranker (logit scale, like mMiniLM): passages that mention "relevant" score 2, everything else -5.
let server: ReturnType<typeof Bun.serve>
const original = MemoryRerank.endpoint.base
const savedFlag = process.env.MEMORY_RERANK

beforeAll(() => {
  process.env.MEMORY_RERANK = "1"
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (url.pathname === "/health") return Response.json({ ok: true })
      if (url.pathname === "/rerank") {
        const body = (await req.json()) as { docs: string[] }
        return Response.json({ scores: body.docs.map((d) => (d.includes("relevant") ? 2 : -5)), device: "cpu" })
      }
      return new Response("not found", { status: 404 })
    },
  })
  MemoryRerank.endpoint.base = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  server.stop(true)
  MemoryRerank.endpoint.base = original
  process.env.MEMORY_RERANK = savedFlag
})

const vault = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-rr-"))
  fs.mkdirSync(path.join(dir, "entries"), { recursive: true })
  fs.writeFileSync(path.join(dir, "entries", "a.md"), "# Catatan relevant tentang proxy pool\n\nproxy pool di web tidak bisa diatur")
  fs.writeFileSync(path.join(dir, "entries", "b.md"), "# Catatan lain\n\nproxy pool dibahas juga di sini tapi tidak cocok")
  MemoryIndex.build(dir)
  return dir
}

describe("MemoryRerank.score", () => {
  test("returns one score per passage from the service", async () => {
    expect(await MemoryRerank.score("proxy", ["relevant satu", "tidak"])).toEqual([2, -5])
  })
  test("returns null when the service is unreachable", async () => {
    const saved = MemoryRerank.endpoint.base
    MemoryRerank.endpoint.base = "http://127.0.0.1:1"
    try {
      expect(await MemoryRerank.score("proxy", ["relevant"])).toBeNull()
    } finally {
      MemoryRerank.endpoint.base = saved
    }
  })
})

describe("MemoryIndex.recall", () => {
  test("keeps only passages the reranker scores at or above the threshold", async () => {
    const dir = vault()
    const hits = await MemoryIndex.recall(dir, "proxy pool web")
    expect(hits.length).toBe(1)
    expect(hits[0]!.path).toContain("a.md")
  })
  test("returns keyword order when the reranker is down", async () => {
    const dir = vault()
    const saved = MemoryRerank.endpoint.base
    MemoryRerank.endpoint.base = "http://127.0.0.1:1"
    try {
      const hits = await MemoryIndex.recall(dir, "proxy pool web")
      expect(hits.length).toBeGreaterThan(0)
      expect(hits).toEqual(MemoryIndex.query(dir, "proxy pool web"))
    } finally {
      MemoryRerank.endpoint.base = saved
    }
  })
  test("returns nothing when no keyword candidate exists", async () => {
    const dir = vault()
    expect(await MemoryIndex.recall(dir, "resep rendang padang")).toEqual([])
  })
})
