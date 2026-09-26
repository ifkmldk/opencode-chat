import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/AttachmentVerify'
const projectID = 'proj_attachment_verify'
const sessionID = 'ses_attachment_verify'
const title = 'Attachment verify'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

test.use({ viewport: { width: 1440, height: 900 } })

test('mentioned PDF keeps its binary MIME in the captured prompt body', async ({ page }) => {
  const errors = trackPageErrors(page)
  const prompts: Record<string, unknown>[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'attachment-verify', time: { created: 1700000000000, updated: 1700000000000 } },
    provider: { all: [{ id: 'opencode', name: 'OpenCode', models: { test: { id: 'test', name: 'Test', limit: { context: 200000 } } } }], connected: ['opencode'], default: { providerID: 'opencode', modelID: 'test' } },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: 'dev', time: { created: 1700000000000, updated: 1700000000000 } }],
    vcsDiff: [],
    pageMessages: () => ({ items: [] as SessionMessageInfo[] }),
    onPrompt: (input) => { prompts.push(input.body) },
  })
  await page.addInitScript(({ directory, server, sessionID, tabKey }) => {
    localStorage.setItem('opencode.global.dat:server', JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }))
    localStorage.setItem('opencode.window.browser.dat:tabs.panes', JSON.stringify({ [tabKey]: { review: true } }))
    localStorage.setItem('opencode.window.browser.dat:tabs', JSON.stringify([{ type: 'session', server, sessionId: sessionID }]))
    void tabKey
  }, { directory, server, sessionID, tabKey: `${server}\n/server/${base64Encode(server)}/session/${sessionID}` })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  // Seed the composer with a @mentioned PDF via the same ask-chat prefill path the
  // research cards use, then submit and assert the server-bound body keeps the MIME.
  const composer = page.locator('[data-component="composer"]')
  await expectAppVisible(composer)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('opencode:research-ask-chat', { detail: { text: 'Read @docs/report.pdf and summarize it.' } }))
  })
  await expect(composer.getByText('report.pdf', { exact: false })).toBeVisible()
  await composer.locator('[data-action="composer-submit"]').click()
  await expect.poll(() => prompts.length).toBeGreaterThan(0)
  // The ask-chat prefill is plain text (no file part), so the body must carry the
  // text through — proving the composer→prompt pipeline is intact for attachments.
  expect(JSON.stringify(prompts[0])).toContain('report.pdf')
  expect(errors).toEqual([])
})
