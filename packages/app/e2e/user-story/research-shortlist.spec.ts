import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/ResearchShortlist'
const projectID = 'proj_research_shortlist'
const sessionID = 'ses_research_shortlist'
const title = 'Research shortlist'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

const toolOutput = JSON.stringify({
  query: 'Grand Bali',
  category: 'hotel',
  providers: [{ provider: 'web-search', status: 'configured' }],
  candidates: [
    {
      id: 'hotel-grand-bali',
      category: 'hotel',
      title: 'Grand Bali',
      url: 'https://example.com/bali',
      summary: 'Beachfront resort with breakfast',
      provider: 'web-search',
      price: 120,
      currency: 'USD',
      rating: 4.8,
      location: 'Bali',
    },
  ],
})

const assistantToolMessage: SessionMessageInfo = {
  id: 'msg_tool_research',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'opencode', id: 'test' },
  time: { created: 1700000000001 },
  content: [
    {
      type: 'tool',
      id: 'part_tool_research',
      name: 'research_search',
      state: {
        status: 'completed',
        input: { query: 'Grand Bali', category: 'hotel' },
        content: [{ type: 'text', text: toolOutput }],
      },
      time: { created: 1700000000002 },
    },
  ],
}

test.use({ viewport: { width: 1440, height: 900 } })

test('research candidate shortlist button prefills the composer for the model to save', async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'research-shortlist', time: { created: 1700000000000, updated: 1700000000000 } },
    provider: { all: [{ id: 'opencode', name: 'OpenCode', models: { test: { id: 'test', name: 'Test', limit: { context: 200000 } } } }], connected: ['opencode'], default: { providerID: 'opencode', modelID: 'test' } },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: 'dev', time: { created: 1700000000000, updated: 1700000000000 } }],
    vcsDiff: [],
    pageMessages: () => ({ items: [assistantToolMessage] }),
  })
  await page.addInitScript(({ directory, server, sessionID, tabKey }) => {
    localStorage.setItem('opencode.global.dat:server', JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }))
    localStorage.setItem('opencode.window.browser.dat:tabs', JSON.stringify([{ type: 'session', server, sessionId: sessionID }]))
    void tabKey
  }, { directory, server, sessionID, tabKey: `${server}\n/server/${base64Encode(server)}/session/${sessionID}` })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.getByRole('button', { name: 'Used 1 research_search' }).click()
  const card = page.locator('[data-component="assistant-result-card"]', { hasText: 'Grand Bali' })
  await expectAppVisible(card)
  await card.getByRole('button', { name: 'Shortlist', exact: true }).click()
  const composer = page.locator('[data-component="composer"]')
  await expect(composer.getByText('research_shortlist save', { exact: false })).toBeVisible()
  await expect(composer.getByText('hotel-grand-bali', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})
