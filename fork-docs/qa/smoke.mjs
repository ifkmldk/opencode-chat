// Smoke test against a running server with the scripted mock model (opencode-qa-uxdiff/mock-llm.ts).
//   QA_BASE=http://127.0.0.1:4208 QA_PASSWORD=qa-uxdiff QA_DIR=C:\path\to\project bun fork-docs/qa/smoke.mjs
// Checks the pipes: server, tools, scraper, office, todo, guard, MCP. It does not judge answer quality (see uat.mjs).
import { connect, report } from "./harness.mjs"

const qa = connect({
  base: process.env.QA_BASE ?? "http://127.0.0.1:4208",
  password: process.env.QA_PASSWORD ?? "qa-uxdiff",
  directory: process.env.QA_DIR ?? "C:\\Users\\fadhi\\opencode-qa-uxdiff\\project",
})

const results = []
const check = async (name, fn) => {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: `${detail ?? ""} (${Date.now() - started} ms)`.trim() })
  } catch (error) {
    results.push({ name, ok: false, detail: String(error?.message ?? error).slice(0, 300) })
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

await check("server info", async () => {
  const info = await qa.info()
  expect(info.version, "no version")
  return info.version
})

await check("MCP servers listed", async () => {
  const mcp = await qa.call("GET", "/api/mcp")
  const list = mcp.data ?? mcp.items ?? mcp
  return `${Array.isArray(list) ? list.length : Object.keys(list).length} servers`
})

const session = await qa.session("smoke").catch((error) => {
  results.push({ name: "create session", ok: false, detail: String(error.message) })
})

if (session) {
  const turn = (text, timeoutMs) => qa.ask(session, text, { timeoutMs })

  await check("todo_write: checklist card data", async () => {
    const t = await turn("buat checklist", 60000)
    const call = t.tools.find((tool) => tool.name === "todo_write")
    expect(call?.status === "completed", `todo_write ${call?.status ?? "not called"}`)
    expect(call.output.includes("of 3 done"), `unexpected output: ${call.output.slice(0, 80)}`)
  })

  await check("shell guard blocks a piped download", async () => {
    const t = await turn("pipa unduhan", 60000)
    const call = t.tools.find((tool) => tool.name === "shell" || tool.name === "bash")
    expect(call, "shell not called")
    expect(call.status === "error" && /safety guard/i.test(call.error ?? ""), `guard did not block: ${call.status} ${call.error ?? ""}`)
  })

  await check("office_render: renders pages (needs project/sample.pptx)", async () => {
    const t = await turn("render dokumen", 120000)
    const call = t.tools.find((tool) => tool.name === "office_render")
    expect(call?.status === "completed", `office_render ${call?.status ?? "not called"} ${call?.error ?? ""}`)
    expect(Array.isArray(call.metadata?.files) && call.metadata.files.length > 0, "no page files in metadata")
    return `${call.metadata.pages} pages via ${call.metadata.engine}`
  })

  await check("scrape_fetch: reads a JavaScript-built careers page", async () => {
    const t = await turn("baca karir", 150000)
    const call = t.tools.find((tool) => tool.name === "scrape_fetch")
    expect(call?.status === "completed", `scrape_fetch ${call?.status ?? "not called"} ${call?.error ?? ""}`)
    expect(call.output.length > 1000, `only ${call.output.length} characters`)
    return `${call.output.length} characters`
  })

  await check("write tool: file created", async () => {
    const t = await turn("tulis file", 60000)
    const call = t.tools.find((tool) => tool.name === "write")
    expect(call?.status === "completed", `write ${call?.status ?? "not called"} ${call?.error ?? ""}`)
  })
}

const ok = report("SMOKE", results)
process.exit(ok ? 0 : 1)
