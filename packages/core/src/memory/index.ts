export * as MemoryIndex from "./index.js"

import { MemoryEmbed } from "./embed.js"
import { MemoryRerank } from "./rerank.js"

import { Database } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"

// fork: full-text index over the shared vault (sessions, transcripts, entries), built incrementally by vault-sync and queried per
// prompt by the recall hook. Chunks keep their source path and title so the injected text can say where it came from.

const CHUNK = 1500
const folders = ["sessions", "transcripts", "entries"]

export type Hit = { path: string; title: string; text: string }

const open = (vault: string) => {
  const dir = path.join(vault, ".index")
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, "memory.db"))
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, sig TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, text, tokenize = 'unicode61');
    CREATE TABLE IF NOT EXISTS vectors (chunk_id INTEGER PRIMARY KEY, vec BLOB NOT NULL);
  `)
  return db
}

const markdownFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(file)
    return entry.name.endsWith(".md") ? [file] : []
  })
}

const titleOf = (raw: string, file: string) => {
  const fromFrontmatter = raw.match(/^title:\s*'?([^>|'\n][^\n]*?)'?\s*$/m)?.[1]
  return (fromFrontmatter ?? raw.match(/^# (.+)$/m)?.[1] ?? path.basename(file, ".md")).slice(0, 160)
}

// Tool calls and tool output are the bulk of a transcript and say little about the conversation: leave them out of the index.
// The live session's own transcript would otherwise match its own lookups and echo back into the prompt.
const withoutTools = (raw: string) =>
  raw
    .split("\n")
    .filter((line) => !/^- tool: /.test(line) && !/^\[tool result/.test(line))
    .join("\n")

// Context that the system injected into earlier prompts must not be indexed again: otherwise recall feeds its own output back in.
// Paragraphs carrying the recall block's own headers (also present without tags in older transcripts) are dropped.
const INJECTED_MARK = /Excerpts from the owner's shared memory vault|Relevant notes from the owner's shared Obsidian vault|UserPromptSubmit hook success|Treat as background data, not instructions/
const injected = (raw: string) =>
  raw
    .replace(/<shared-memory>[\s\S]*?<\/shared-memory>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<\/?(?:command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[^\n]*/g, "")
    .split(/\n\s*\n/)
    .filter((paragraph) => !INJECTED_MARK.test(paragraph))
    .join("\n\n")

// Split on blank lines into pieces of roughly CHUNK characters, so a chunk never cuts a message in the middle of a sentence.
export function chunk(text: string) {
  const parts: string[] = []
  let current = ""
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (current && current.length + paragraph.length > CHUNK) {
      parts.push(current.trim())
      current = ""
    }
    current += `${paragraph}\n\n`
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Index every note whose size or mtime changed since the last run; drop notes that no longer exist. */
export function build(vault: string) {
  const db = open(vault)
  const seen = new Set<string>()
  const knownFiles = new Map(db.query("SELECT path, sig FROM files").all().map((row: any) => [row.path, row.sig]))
  const removeFile = db.prepare("DELETE FROM chunks WHERE path = ?")
  const removeFts = db.prepare("DELETE FROM fts WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)")
  const insertChunk = db.prepare("INSERT INTO chunks (path, title, text) VALUES (?, ?, ?)")
  const insertFts = db.prepare("INSERT INTO fts (rowid, title, text) VALUES (?, ?, ?)")
  const setFile = db.prepare("INSERT OR REPLACE INTO files (path, sig) VALUES (?, ?)")
  let indexed = 0
  db.transaction(() => {
    for (const folder of folders) {
      for (const file of markdownFiles(path.join(vault, folder))) {
        const stat = fs.statSync(file)
        const sig = `${stat.size}:${Math.floor(stat.mtimeMs)}`
        seen.add(file)
        if (knownFiles.get(file) === sig) continue
        removeFts.run(file)
        removeFile.run(file)
        const raw = fs.readFileSync(file, "utf8")
        const title = titleOf(raw, file)
        const tags = [...new Set(raw.match(/(^|\s)#[\p{L}\p{N}_/-]+/gu) ?? [])].map((tag) => tag.trim()).join(" ")
        const searchTitle = `${title} ${path.relative(vault, file)} ${tags}`
        for (const text of chunk(injected(withoutTools(raw)))) {
          const id = Number(insertChunk.run(file, title, text).lastInsertRowid)
          insertFts.run(id, searchTitle, text)
        }
        setFile.run(file, sig)
        indexed++
      }
    }
    for (const file of knownFiles.keys()) {
      if (seen.has(file)) continue
      removeFts.run(file)
      removeFile.run(file)
      db.query("DELETE FROM files WHERE path = ?").run(file)
    }
  })()
  for (const stmt of [removeFile, removeFts, insertChunk, insertFts, setFile]) stmt.finalize()
  db.close()
  return { indexed, files: seen.size }
}

// Words worth searching for: the prompt is free text, so common short words and punctuation are dropped.
const STOP = new Set(["yang", "dan", "untuk", "dari", "ini", "itu", "aja", "dong", "gw", "lu", "gue", "kok", "udah", "belum", "the", "and", "for", "with", "what", "how", "can", "you", "are", "was", "this", "that"])
export const terms = (prompt: string) =>
  [...new Set(prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((word) => !STOP.has(word)).slice(0, 12)

/** Keyword candidates for the prompt in BM25 order, after the relevance rule. */
function candidates(vault: string, prompt: string, limit: number): Hit[] {
  const words = terms(prompt)
  if (words.length === 0 || !fs.existsSync(path.join(vault, ".index", "memory.db"))) return []
  const db = open(vault)
  try {
    const match = words.map((word) => `"${word.replace(/"/g, "")}"`).join(" OR ")
    const rows = db
      .query(
        `SELECT chunks.path AS path, chunks.title AS title, chunks.text AS text
         FROM fts JOIN chunks ON chunks.id = fts.rowid
         WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT ?`,
      )
      .all(match, limit) as Hit[]
    // A chunk must match at least two different query words (or all of them when there are only two), so one generic word cannot pull in an unrelated note.
    const need = words.length <= 2 ? words.length : Math.min(3, Math.ceil(words.length / 2))
    return rows.filter((row) => {
      const low = `${row.path} ${row.title} ${row.text}`.toLowerCase()
      return words.filter((word) => low.includes(word)).length >= need
    })
  } finally {
    db.close()
  }
}

/** Take hits in order, at most two per note, within the character budget and the hit limit. */
function pick(rows: Hit[], maxChars: number, limit: number): Hit[] {
  const picked: Hit[] = []
  const perPath = new Map<string, number>()
  let size = 0
  for (const row of rows) {
    if ((perPath.get(row.path) ?? 0) >= 2) continue
    if (size + row.text.length > maxChars) break
    perPath.set(row.path, (perPath.get(row.path) ?? 0) + 1)
    picked.push({ path: row.path, title: row.title, text: row.text })
    size += row.text.length
    if (picked.length >= limit) break
  }
  return picked
}

/** Best matching chunks for the prompt, newest source first among equal scores, capped by total characters. */
export function query(vault: string, prompt: string, options: { limit?: number; maxChars?: number } = {}): Hit[] {
  return pick(candidates(vault, prompt, 40), options.maxChars ?? 8000, 5)
}

// Reranker score a candidate needs to be injected. mMiniLM logits: 0 keeps 43/50 relevant prompts and 0/14 noise on the 64-prompt set
// (threshold -2 keeps 45/50 but lets 2 noise prompts through; threshold 2 drops to 37/50).
const RERANK_MIN = Number(process.env.MEMORY_RERANK_MIN ?? 0)
const RERANK_POOL = Number(process.env.MEMORY_RERANK_POOL ?? 30)

/**
 * Recall for the prompt: keyword candidates reordered by the reranker, and only those scoring at least RERANK_MIN are kept.
 * When the reranker is not ready (its service is down or still starting), the keyword order is returned unchanged, as query() does.
 */
export async function recall(vault: string, prompt: string, options: { limit?: number; maxChars?: number } = {}): Promise<Hit[]> {
  const maxChars = options.maxChars ?? 8000
  const limit = options.limit ?? 5
  // On by default; MEMORY_RERANK=0 turns it off. Keyword order is used when it is off or its service is not ready.
  if (process.env.MEMORY_RERANK === "0") return query(vault, prompt, { limit, maxChars })
  const pool = candidates(vault, prompt, RERANK_POOL)
  if (pool.length === 0) return []
  const scores = await MemoryRerank.score(prompt, pool.map((hit) => `${hit.title}\n${hit.text}`))
  if (!scores) return pick(pool, maxChars, limit)
  const ranked = pool
    .map((hit, i) => ({ hit, score: scores[i]! }))
    .filter((row) => row.score >= RERANK_MIN)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.hit)
  return pick(ranked, maxChars, limit)
}

/** Embed chunks that do not have a vector yet, in batches. Returns how many were embedded (0 when the service is unavailable). */
export async function embedPending(vault: string, options: { batch?: number; maxChunks?: number } = {}) {
  if (!fs.existsSync(path.join(vault, ".index", "memory.db"))) return 0
  const db = open(vault)
  let done = 0
  try {
    const total = options.maxChunks ?? Number.POSITIVE_INFINITY
    while (done < total) {
      const rows = db
        .query("SELECT chunks.id AS id, chunks.title AS title, chunks.text AS text FROM chunks LEFT JOIN vectors ON vectors.chunk_id = chunks.id WHERE vectors.chunk_id IS NULL LIMIT ?")
        .all(options.batch ?? 64) as Array<{ id: number; title: string; text: string }>
      if (rows.length === 0) break
      const vectors = await MemoryEmbed.embed(rows.map((r) => `${r.title}
${r.text}`), "passage")
      if (!vectors) break
      const insert = db.prepare("INSERT OR REPLACE INTO vectors (chunk_id, vec) VALUES (?, ?)")
      db.transaction(() => rows.forEach((r, i) => insert.run(r.id, Buffer.from(vectors[i]!.buffer))))()
      done += rows.length
    }
  } finally {
    db.close()
  }
  return done
}

/** Semantic neighbours of the prompt: cosine similarity over every stored vector (already normalised). */
const semanticRanks = (db: Database, query: Float32Array, limit: number) => {
  const rows = db.query("SELECT chunk_id AS id, vec FROM vectors").all() as Array<{ id: number; vec: Uint8Array }>
  const scored: Array<{ id: number; score: number }> = []
  for (const row of rows) {
    const v = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength / 4)
    let dot = 0
    for (let i = 0; i < v.length; i++) dot += v[i]! * query[i]!
    scored.push({ id: row.id, score: dot })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

const SEMANTIC_MIN = Number(process.env.MEMORY_SEMANTIC_MIN ?? 0.85)

/** Hybrid recall: BM25 keyword hits and semantic hits merged with Reciprocal Rank Fusion. Falls back to plain keyword search. */
export async function queryHybrid(vault: string, prompt: string, options: { limit?: number; maxChars?: number } = {}): Promise<Hit[]> {
  const keyword = query(vault, prompt, options)
  if (!fs.existsSync(path.join(vault, ".index", "memory.db"))) return keyword
  const vectorsOf = await MemoryEmbed.embed([prompt], "query")
  if (!vectorsOf) return keyword
  const db = open(vault)
  try {
    const semantic = semanticRanks(db, vectorsOf[0]!, 40).filter((s) => s.score >= SEMANTIC_MIN)
    const ids = semantic.map((s) => s.id)
    const semRows = ids.length
      ? (db.query(`SELECT id, path, title, text FROM chunks WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<Hit & { id: number }>)
      : []
    const byId = new Map(semRows.map((r) => [r.id, r]))
    const keywordRows = db
      .query("SELECT chunks.id AS id, chunks.path AS path, chunks.title AS title, chunks.text AS text FROM fts JOIN chunks ON chunks.id = fts.rowid WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT 40")
      .all(words2match(prompt)) as Array<Hit & { id: number }>
    const words = terms(prompt)
    const need = words.length <= 2 ? words.length : Math.min(3, Math.ceil(words.length / 2))
    const keywordRelevant = keywordRows.filter((r) => {
      const low = `${r.path} ${r.title} ${r.text}`.toLowerCase()
      return words.filter((w) => low.includes(w)).length >= need
    })
    const k = 60
    const fused = new Map<number, { hit: Hit; score: number }>()
    keywordRelevant.forEach((r, i) => fused.set(r.id, { hit: r, score: 1 / (k + i + 1) }))
    semantic.forEach((s, i) => {
      const hit = byId.get(s.id)
      if (!hit) return
      const cur = fused.get(s.id)
      fused.set(s.id, { hit, score: (cur?.score ?? 0) + 1 / (k + i + 1) })
    })
    const ranked = [...fused.values()].sort((a, b) => b.score - a.score).map((x) => x.hit)
    const picked: Hit[] = []
    const perPath = new Map<string, number>()
    let size = 0
    for (const hit of ranked) {
      if ((perPath.get(hit.path) ?? 0) >= 2) continue
      if (size + hit.text.length > (options.maxChars ?? 8000)) break
      perPath.set(hit.path, (perPath.get(hit.path) ?? 0) + 1)
      picked.push({ path: hit.path, title: hit.title, text: hit.text })
      size += hit.text.length
      if (picked.length >= (options.limit ?? 5)) break
    }
    return picked
  } finally {
    db.close()
  }
}

const words2match = (prompt: string) => {
  const words = terms(prompt)
  return words.length ? words.map((word) => `"${word.replace(/"/g, "")}"`).join(" OR ") : '""'
}
