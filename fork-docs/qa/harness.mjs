// QA harness: drives a running opencode server over its REST API. No dependencies (Node 18+ or Bun).
//
//   import { connect } from "./harness.mjs"
//   const qa = connect({ base: "http://127.0.0.1:4208", password: "qa-uxdiff", directory: "C:\\path\\to\\project" })
//   const s = await qa.session("title")
//   const turn = await qa.ask(s, "cari hotel di BSD", { timeoutMs: 180000 })
//   turn.text, turn.tools  // [{ name, status, input, output, error }]
//
// Used by smoke.mjs (mock model, deterministic), and by the real-model UAT runner (uat.mjs).

export function connect({ base, password, user = "opencode", directory }) {
  const headers = { authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64"), "content-type": "application/json" }
  const url = (path) => `${base}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(directory)}`
  const call = async (method, path, body, { timeoutMs = 60000, raw = false } = {}) => {
    const response = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const text = await response.text()
    if (raw) return { status: response.status, text }
    let json
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`)
    return json
  }

  const textOf = (parts) => parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")
  const toolOf = (part) => ({
    name: part.name,
    status: part.state?.status,
    input: part.state?.input,
    output: (part.state?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n"),
    error: part.state?.error?.message ?? (typeof part.state?.error === "string" ? part.state.error : undefined),
    metadata: part.state?.metadata,
  })

  return {
    call,
    info: () => call("GET", "/api/info"),
    async session(title, extra = {}) {
      const created = await call("POST", "/api/session", { title, ...extra })
      return created.data.id
    },
    async messages(sessionID) {
      const page = await call("GET", `/api/session/${sessionID}/message?limit=200`)
      return page.items ?? page.data ?? []
    },
    /** Send one user message, wait for the agent to go idle, return what the assistant did in response. */
    async ask(sessionID, text, { timeoutMs = 120000 } = {}) {
      const seen = new Set((await this.messages(sessionID)).map((message) => message.id))
      const started = Date.now()
      await call("POST", `/api/session/${sessionID}/prompt`, { text })
      await call("POST", `/api/experimental/session/${sessionID}/wait`, undefined, { timeoutMs, raw: true })
      const all = await this.messages(sessionID)
      // Messages come newest first; take the assistant messages created after the prompt, oldest first.
      const fresh = all.filter((message) => !seen.has(message.id) && message.type === "assistant" && Array.isArray(message.content)).reverse()
      const parts = fresh.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      const tools = parts.filter((part) => part.type === "tool").map(toolOf)
      return {
        text: textOf(parts),
        tools,
        reasoning: parts.filter((part) => part.type === "reasoning").map((part) => part.text).join("\n"),
        ms: Date.now() - started,
        raw: fresh,
      }
    },
  }
}

export function report(name, results) {
  const failed = results.filter((item) => !item.ok)
  const lines = results.map((item) => `${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? `  — ${item.detail}` : ""}`)
  console.log(`\n${name}\n${lines.join("\n")}\n${results.length - failed.length}/${results.length} passed`)
  return failed.length === 0
}
