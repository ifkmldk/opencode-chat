import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/ViewModeToggle'
const projectID = 'proj_view_mode'
const sessionID = 'ses_view_mode'
const title = 'View mode toggle'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

// Assistant message with a completed result tool: every view mode keeps result cards visible.
const assistantToolMessage: SessionMessageInfo = {
  id: 'msg_tool_viewmode',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'opencode', id: 'test' },
  time: { created: 1700000000001 },
  content: [
    {
      type: 'tool',
      id: 'part_tool_viewmode',
      name: 'research_search',
      state: {
        status: 'completed',
        input: { query: 'Bali hotel', category: 'hotel' },
        content: [{ type: 'text', text: '{"query":"Bali hotel","category":"hotel","providers":[],"candidates":[]}' }],
      },
      time: { created: 1700000000002 },
    },
  ],
} as unknown as SessionMessageInfo

test.use({ viewport: { width: 1440, height: 900 } })

test('chat/code/laya view mode picker selects, persists, and keeps result cards', async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'view-mode', time: { created: 1700000000000, updated: 1700000000000 } },
    provider: { all: [{ id: 'opencode', name: 'OpenCode', models: { test: { id: 'test', name: 'Test', limit: { context: 200000 } } } }], connected: ['opencode'], default: { providerID: 'opencode', modelID: 'test' } },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: 'dev', time: { created: 1700000000000, updated: 1700000000000 } }],
    vcsDiff: [],
    pageMessages: () => ({ items: [assistantToolMessage] }),
  })
  await page.addInitScript(({ directory, server, sessionID, tabKey }) => {
    localStorage.setItem('opencode.global.dat:server', JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }))
    localStorage.setItem('opencode.window.browser.dat:tabs.panes', JSON.stringify({ [tabKey]: { review: true } }))
    localStorage.setItem('opencode.window.browser.dat:tabs', JSON.stringify([{ type: 'session', server, sessionId: sessionID }]))
    void tabKey
  }, { directory, server, sessionID, tabKey: `${server}\n/server/${base64Encode(server)}/session/${sessionID}` })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const picker = page.locator('[data-action="composer-view-mode"]')
  const choose = async (label: string) => {
    await picker.getByRole('button').click()
    await page.getByRole('menuitemradio', { name: label }).click()
  }
  await expectAppVisible(picker)

  for (const [label, mode] of [['Chat', 'chat'], ['Laya', 'laya'], ['Code', 'code']] as const) {
    await choose(label)
    await expect(picker).toHaveAttribute('data-mode', mode)
    // Result cards are the answer, not process: visible in every mode.
    await expect(page.getByText('Research status').first()).toBeVisible()
  }

  await choose('Chat')
  await page.reload()
  await expectSessionTitle(page, title)
  await expect(page.locator('[data-action="composer-view-mode"]')).toHaveAttribute('data-mode', 'chat')
  expect(errors).toEqual([])
})