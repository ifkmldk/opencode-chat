import { expect, test } from '@playwright/test'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/CanvasAnnotate'
const projectID = 'proj_canvas_annotate'
const sessionID = 'ses_canvas_annotate'
const title = 'Canvas annotate'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

test.use({ viewport: { width: 1440, height: 900 } })

test('canvas region selection stages a media annotation and sends it with the prompt', async ({ page }) => {
  const errors = trackPageErrors(page)
  const prompts: Record<string, unknown>[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'canvas-annotate', time: { created: 1700000000000, updated: 1700000000000 } },
    provider: { all: [{ id: 'opencode', name: 'OpenCode', models: { test: { id: 'test', name: 'Test', limit: { context: 200000 } } } }], connected: ['opencode'], default: { providerID: 'opencode', modelID: 'test' } },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: 'dev', time: { created: 1700000000000, updated: 1700000000000 } }],
    vcsDiff: [],
    pageMessages: () => ({ items: [] }),
    onPrompt: (input) => { prompts.push(input.body) },
  })
  await page.addInitScript(({ directory, server, sessionID, tabKey }) => {
    localStorage.setItem('opencode.global.dat:server', JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }))
    localStorage.setItem('opencode.window.browser.dat:tabs.panes', JSON.stringify({ [tabKey]: { review: true } }))
    localStorage.setItem('opencode.window.browser.dat:tabs', JSON.stringify([{ type: 'session', server, sessionId: sessionID }]))
  }, { directory, server, sessionID, tabKey: `${server}\n/server/${base64Encode(server)}/session/${sessionID}` })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const panel = page.locator('#review-panel')
  await expectAppVisible(panel)
  await panel.getByRole('button', { name: 'Add tab' }).click()
  await page.getByRole('menuitem', { name: 'Canvas' }).click()
  const tab = panel.getByRole('tab', { name: 'Canvas' })
  await expect(tab).toHaveAttribute('data-selected', '')
  const buffer = await page.evaluate(() => {
    const stage = document.createElement('canvas')
    stage.width = 200
    stage.height = 120
    const ctx = stage.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 200, 120)
    ctx.fillStyle = '#1d4ed8'
    ctx.fillRect(20, 20, 60, 40)
    return new Promise<number[]>((resolve) => stage.toBlob((blob) => blob!.arrayBuffer().then((ab) => resolve([...new Uint8Array(ab)]))))
  })
  await panel.getByText('Upload image').click()
  await panel.locator('input[type="file"]').setInputFiles({ name: 'canvas-fixture.png', mimeType: 'image/png', buffer: Buffer.from(buffer) })
  const overlay = panel.locator('canvas.cursor-crosshair')
  await expect(overlay).toBeVisible()
  const box = await overlay.boundingBox()
  if (!box) throw new Error('canvas overlay has no bounding box')
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Quote', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Quote', exact: true }).click()
  const composer = page.locator('[data-component="composer"]')
  await expect(composer.getByText('Annotation', { exact: false }).first()).toBeVisible()
  const editor = composer.locator('[data-component="composer-editor"]')
  await editor.fill('describe this crop')
  await composer.locator('[data-action="composer-submit"]').click()
  await expect.poll(() => prompts.length).toBeGreaterThan(0)
  const body = prompts[0] as { text?: string; files?: { mime?: string; name?: string }[] }
  expect(String(body.text ?? '')).toContain('Canvas annotation')
  expect(JSON.stringify(body)).toContain('canvas-annotation')
  const state = await page.evaluate(() => ({ errors: (window as unknown as { __x?: string }).__x }))
  void state
  expect(errors).toEqual([])
})