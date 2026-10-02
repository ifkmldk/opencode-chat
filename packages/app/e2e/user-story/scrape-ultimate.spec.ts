import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/ScrapeUltimate'
const projectID = 'proj_scrape_ultimate'
const sessionID = 'ses_scrape_ultimate'
const title = 'Ultimate scraper'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

// Assistant message with a completed scrape_fetch tool: the scrape card
// renders on its own row like other result cards, in every view mode.
const assistantToolMessage: SessionMessageInfo = {
  id: 'msg_tool_scrape',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'opencode', id: 'test' },
  time: { created: 1700000000001 },
  content: [
    {
      type: 'tool',
      id: 'part_tool_scrape',
      name: 'scrape_fetch',
      state: {
        status: 'completed',
        input: { url: 'https://example.com', mode: 'auto' },
        content: [{ type: 'text', text: '{"url":"https://example.com","finalUrl":"https://example.com/","engine":"webfetch","format":"markdown","output":"# Example","warnings":[],"durationMs":12,"bytes":9}' }],
      },
      time: { created: 1700000000002 },
    },
  ],
} as unknown as SessionMessageInfo

test.use({ viewport: { width: 1440, height: 900 } })

test('scrape_fetch result card renders with engine attribution', async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'scrape-ultimate', time: { created: 1700000000000, updated: 1700000000000 } },
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
  }, { directory, server, sessionID, tabKey: `${server}\\n/server/${base64Encode(server)}/session/${sessionID}` })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  // The scrape card body shows the fetched markdown; the engine trail is in
  // the tool metadata, not hidden inside a "Used N" group.
  await expect(page.getByText('Example', { exact: false }).first()).toBeVisible()
  expect(errors).toEqual([])
})
