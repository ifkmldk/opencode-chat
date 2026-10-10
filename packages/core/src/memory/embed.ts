export * as MemoryEmbed from "./embed.js"

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Client for the on-demand local embedding service (script/embed-service.py). Every failure returns null, so recall keeps working
// on keyword search alone. The service is started only when a query needs it and exits by itself after idle time.

const PORT = Number(process.env.EMBED_PORT ?? 4311)
const BASE = `http://127.0.0.1:${PORT}`
const PYTHON = process.env.EMBED_PYTHON ?? "python"
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "script", "embed-service.py")
const TIMEOUT_MS = 1500
const COLD_TIMEOUT_MS = 120000

const healthy = async (timeout = TIMEOUT_MS) => {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(timeout) })
    return res.ok
  } catch {
    return false
  }
}

let starting: Promise<boolean> | undefined

/** Start the service in the background if it is not answering, then wait until it does (or give up). */
export function ensure(): Promise<boolean> {
  starting ??= (async () => {
    if (await healthy()) return true
    const child = spawn(PYTHON, [SCRIPT], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, EMBED_PORT: String(PORT) } })
    child.unref()
    const deadline = Date.now() + COLD_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await healthy()) return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  })().finally(() => {
    starting = undefined
  })
  return starting
}

/** Embeddings for texts (normalised, 384 dimensions), or null when the service is unavailable. */
export async function embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[] | null> {
  if (texts.length === 0) return []
  if (!(await ensure())) return null
  try {
    const res = await fetch(`${BASE}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts, kind }),
      signal: AbortSignal.timeout(COLD_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { vectors: number[][] }
    return body.vectors.map((v) => Float32Array.from(v))
  } catch {
    return null
  }
}

/** Cosine similarity of two normalised vectors. */
export const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}
