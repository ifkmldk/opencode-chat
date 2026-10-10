export * as MemoryRerank from "./rerank.js"

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Client for the on-demand reranker service (script/rerank-service.py). Scores (query, passage) pairs for keyword candidates.
// Never waits for a cold start: when the service is down, the first call only starts it in the background and returns null,
// so the recall hook keeps its keyword order instead of stalling the prompt.

const PORT = Number(process.env.RERANK_PORT ?? 4312)
// Mutable so tests can point the client at a fake service.
export const endpoint = { base: `http://127.0.0.1:${PORT}` }
const PYTHON = process.env.EMBED_PYTHON ?? "python"
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "script", "rerank-service.py")
const HEALTH_TIMEOUT_MS = 800
const RERANK_TIMEOUT_MS = 5000

const healthy = async () => {
  try {
    const res = await fetch(`${endpoint.base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

let starting = false

/** Start the service in the background when it is not answering. Does not wait for it to load. */
function startInBackground() {
  if (starting) return
  starting = true
  const child = spawn(PYTHON, [SCRIPT], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, RERANK_PORT: String(PORT) } })
  child.on("error", () => {})
  child.unref()
  setTimeout(() => {
    starting = false
  }, 180_000).unref()
}

/** Relevance score per document (higher is better), or null when the service is not ready. */
export async function score(query: string, docs: string[]): Promise<number[] | null> {
  if (docs.length === 0) return []
  if (!(await healthy())) {
    startInBackground()
    return null
  }
  try {
    const res = await fetch(`${endpoint.base}/rerank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, docs }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { scores: number[] }
    return body.scores.length === docs.length ? body.scores : null
  } catch {
    return null
  }
}
