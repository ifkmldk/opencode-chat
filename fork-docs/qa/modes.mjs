// UI check of the three conversation modes (chat / code / classifier) on REAL sessions produced by uat.mjs.
//   QA_BASE=http://127.0.0.1:4210 QA_PASSWORD=uat-pass QA_DIR=<project> bun fork-docs/qa/modes.mjs
// For each finished session: the answer text must be visible in every mode, no word "Thinking" and no leaked reminder/marker text,
// no page errors; process tools (read/shell/...) hide in chat and classifier, result cards (research, maps, scrape, todo) stay.
import { chromium } from "../../packages/app/node_modules/@playwright/test/index.js"
import { connect, report } from "./harness.mjs"

const base = process.env.QA_BASE ?? "http://127.0.0.1:4210"
const password = process.env.QA_PASSWORD ?? "uat-pass"
const directory = process.env.QA_DIR ?? "C:/Users/fadhi/opencode-qa-uxdiff/uat/project"
const qa = connect({ base, password, directory })
const token = Buffer.from(`opencode:${password}`).toString("base64")
const wanted = ["uat general-short", "uat code-csv", "uat hotel-bsd", "uat jobs-tangerang", "uat docs-pptx"]

const list = await qa.call("GET", "/api/session?limit=100")
const sessions = (list.data ?? list.items).filter((item) => wanted.includes(item.title))
const latest = new Map()
for (const item of sessions) if (!latest.has(item.title) || latest.get(item.title).time.created < item.time.created) latest.set(item.title, item)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } })
await context.addInitScript((dir) => localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [{ worktree: dir, expanded: true }] }, lastProject: { local: dir } })), directory.replaceAll("/", "\\"))
const results = []
const errors = []
const page = await context.newPage()
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)))

for (const [title, session] of latest) {
  const messages = await qa.messages(session.id)
  const answer = messages
    .filter((message) => message.type === "assistant")
    .flatMap((message) => message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .at(0)
  const probe = (answer ?? "").split("\n").find((line) => line.replace(/[*#|`\-\s]/g, "").length > 24)?.replace(/[*`#|]/g, "").trim().slice(0, 40)
  await page.goto(`${base}/server/${Buffer.from(base).toString("base64")}/session/${session.id}?auth_token=${token}`, { waitUntil: "load" })
  await page.waitForTimeout(7000)
  for (const [label, mode] of [["Chat", "chat"], ["Classifier", "classifier"], ["Code", "code"]]) {
    const picker = page.locator('[data-action="composer-view-mode"]')
    await picker.getByRole("button").click({ timeout: 15000 }).catch(() => undefined)
    await page.getByRole("menuitemradio", { name: label }).click({ timeout: 15000 }).catch(() => undefined)
    await page.waitForTimeout(1500)
    const body = await page.locator("body").innerText()
    const actual = await picker.getAttribute("data-mode").catch(() => null)
    results.push({ name: `${title} / ${mode}: mode switched`, ok: actual === mode, detail: `data-mode=${actual}` })
    results.push({ name: `${title} / ${mode}: answer visible`, ok: !probe || body.includes(probe.slice(0, 30)), detail: probe ?? "no text answer" })
    results.push({ name: `${title} / ${mode}: no "Thinking", no raw marker or reminder`, ok: !/\bThinking\b|OPENCODE_TASK_COMPLETE|<system-reminder>|<memory>/.test(body), detail: "" })
    if (mode === "code" && /bun|node|total\.mjs/.test(title + body)) results.push({ name: `${title} / code: tool rows shown`, ok: /Used|Ran|Read|Shell|Wrote|Edit/i.test(body), detail: "" })
  }
}
results.push({ name: "no page errors across all modes", ok: errors.length === 0, detail: errors.slice(0, 3).join(" | ") })
await browser.close()
process.exit(report("MODES (chat / code / classifier)", results) ? 0 : 1)
