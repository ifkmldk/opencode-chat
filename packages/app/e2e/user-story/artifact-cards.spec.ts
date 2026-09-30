import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { base64Encode } from "@opencode/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { expectSessionTitle } from "../utils/waits"

// fork: every file a reply produces shows once as a Claude-style card (name, "Kind · TYPE", Download).
const directory = "C:/OpenCode/ArtifactCards"
const tmp = "C:/Users/me/AppData/Local/Temp/opencode"
const projectID = "proj_artifact_cards"
const sessionID = "ses_artifact_cards"
const title = "Artifact cards"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x00, 0x7f])
const csv = "name,total\nalpha,1\nbeta,2\n"
const model = { providerID: "opencode", id: "test" }

const write = (id: string, path: string, created: number) => ({
  type: "tool" as const,
  id,
  name: "write",
  state: {
    status: "completed" as const,
    input: { path, content: "" },
    content: [{ type: "text" as const, text: `Created file successfully: ${path}` }] as [{ type: "text"; text: string }],
  },
  time: { created, completed: created + 5 },
})

const messages: SessionMessageInfo[] = [
  {
    id: "msg_1000_user",
    type: "user",
    time: { created: 1700000000000 },
    text: "Buatkan laporan penjualan.",
    files: [],
    agents: [],
  },
  {
    id: "msg_1001_assistant",
    type: "assistant",
    metadata: { parentID: "msg_1000_user" },
    agent: "build",
    model,
    time: { created: 1700000000100, completed: 1700000000200 },
    finish: "tool-calls",
    content: [write("prt_write_csv", `${tmp}/summary.csv`, 1700000000110), write("prt_write_code", "src/app.ts", 1700000000120)],
  },
  {
    id: "msg_1002_assistant",
    type: "assistant",
    metadata: { parentID: "msg_1000_user" },
    agent: "build",
    model,
    time: { created: 1700000000300, completed: 1700000000400 },
    finish: "stop",
    content: [
      {
        type: "text",
        text: String.raw`Laporan siap: [report.pdf](C:/Users/me/AppData/Local/Temp/opencode/report.pdf), arsipnya ${"`"}C:\Users\me\AppData\Local\Temp\opencode\data.zip${"`"}, dan kodenya di [main](src/main.ts:42).`,
      },
    ],
  },
]

test.use({ viewport: { width: 1440, height: 900 } })

for (const mode of ["code", "chat"] as const) {
  test(`a reply shows one card per produced file and downloads it byte for byte in ${mode} mode`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "artifact-cards",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
      provider: {
        all: [{ id: "opencode", name: "OpenCode", models: { test: { id: "test", name: "Test", limit: { context: 200000 } } } }],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "test" },
      },
      sessions: [
        { id: sessionID, slug: sessionID, projectID, directory, title, version: "dev", time: { created: 1700000000000, updated: 1700000000000 } },
      ],
      pageMessages: () => ({ items: messages }),
      fileList: () => ["summary.csv", "report.pdf", "data.zip"].map((path) => ({ path, type: "file" })),
      fileContent: (path) => (path.endsWith("data.zip") ? zip : path.endsWith("summary.csv") ? csv : "%PDF-1.4"),
    })
    await page.addInitScript(
      ({ directory, mode }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }),
        )
        localStorage.setItem("settings.v3", JSON.stringify({ general: { defaultViewMode: mode } }))
      },
      { directory, mode },
    )
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const groups = page.locator('[data-component="assistant-artifacts"]')
    await expect(groups).toHaveCount(1)
    const cards = groups.locator('[data-component="assistant-artifact"]')
    await expect(cards.locator('[data-slot="assistant-artifact-title"]')).toHaveText(["summary.csv", "report.pdf", "data.zip"])
    await expect(cards.locator('[data-slot="assistant-artifact-type"]')).toHaveText([
      "Spreadsheet · CSV",
      "Document · PDF",
      "Archive · ZIP",
    ])

    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download data.zip", exact: true }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe("data.zip")
    expect(new Uint8Array(await readFile((await file.path())!))).toEqual(zip)

    await cards.filter({ hasText: "summary.csv" }).locator('[data-slot="assistant-artifact-open"]').click()
    const panel = page.locator("#review-panel")
    await expect(panel.getByRole("tab", { name: /summary\.csv/, selected: true })).toBeVisible()
    await expect(panel.getByText("alpha", { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
