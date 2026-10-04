import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/ResearchHonesty'
const projectID = 'proj_research_honesty'
const sessionID = 'ses_research_honesty'
const title = 'Research honesty'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

// Mock research_search output: OSM fallback with distance, station, verified
// badges, source + checkedAt, and honest limitations. The card must show the
// provenance (source, check date, distance) and must NOT invent a final price.
const toolOutput = JSON.stringify({
  query: 'kontrakan sudirman carport',
  category: 'place',
  providers: [{ provider: 'openstreetmap', status: 'configured' }],
  candidates: [
    {
      id: 'kos-sudirman-1',
      category: 'place',
      title: 'Kos Sudirman Carport',
      url: 'https://example.com/kos',
      summary: 'Kos dekat Jl. Sudirman, Bandung',
      provider: 'openstreetmap',
      location: 'Jl. Sudirman, Bandung',
      distanceM: 800,
      station: undefined,
      verified: { carport: 'yes' },
      checkedAt: 1727740800000,
      source: 'openstreetmap',
    },
  ],
  limitations: [
    'Checked 2024-10-01 via openstreetmap.',
    'Free sources have no live date-specific price or availability; prices shown are indications only, not final booking prices.',
  ],
  checkedAt: 1727740800000,
})

const assistantToolMessage: SessionMessageInfo = {
  id: 'msg_tool_honesty',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'opencode', id: 'test' },
  time: { created: 1700000000001 },
  content: [
    {
      type: 'tool',
      id: 'part_tool_honesty',
      name: 'research_search',
      state: {
        status: 'completed',
        input: { query: 'kontrakan sudirman carport', category: 'place' },
        content: [{ type: 'text', text: toolOutput }],
      },
      time: { created: 1700000000002 },
    },
  ],
} as unknown as SessionMessageInfo

test.use({ viewport: { width: 1440, height: 900 } })

test('research honesty card shows source, distance, verification, and limitations', async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'research-honesty', time: { created: 1700000000000, updated: 1700000000000 } },
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

  const card = page.locator('[data-component="assistant-result-card"]', { hasText: 'Kos Sudirman Carport' })
  await expectAppVisible(card)
  // Distance + verified badge + source render in the card meta line.
  await expect(card.getByText('800 m', { exact: false })).toBeVisible()
  await expect(card.getByText('carport: ✓', { exact: false })).toBeVisible()
  await expect(card.getByText('openstreetmap', { exact: false }).first()).toBeVisible()
  // Honest limitations render below the card and never claim a final price.
  const limitation = page.locator('[data-component="research-limitation"]')
  await expect(limitation.first()).toBeVisible()
  await expect(limitation.first()).toContainText('indications only, not final booking prices')
  await expect(page.locator('body')).not.toContainText('final booking price: Rp')
  expect(errors).toEqual([])
})
