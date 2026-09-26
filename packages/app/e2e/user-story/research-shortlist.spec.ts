import { expect, test } from '@playwright/test'
import type { SessionMessageInfo } from '@opencode/client/promise'
import { base64Encode } from '@opencode/util/encode'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible, expectSessionTitle } from '../utils/waits'

const directory = 'C:/OpenCode/ResearchWorkflow'
const projectID = 'proj_research_workflow'
const sessionID = 'ses_research_workflow'
const title = 'Research workflow'
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? '127.0.0.1'}:${process.env.PLAYWRIGHT_SERVER_PORT ?? '4096'}`

const toolOutput = JSON.stringify({
  query: 'Bali hotel',
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
        input: { query: 'Bali hotel', category: 'hotel' },
        content: [{ type: 'text', text: toolOutput }],
      },
      time: { created: 1700000000002 },
    },
  ],
}

test.use({ viewport: { width: 1440, height: 900 } })

test('research workflow asks with filters, shortlists, and drafts an approval-gated action', async ({ page }) => {
  const errors = trackPageErrors(page)
  const prompts: Record<string, unknown>[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: { id: projectID, worktree: directory, vcs: 'git', name: 'research-workflow', time: { created: 1700000000000, updated: 1700000000000 } },
    provider: { all: [{ id: 'opencode', name: 'OpenCode', models: { test: { id: 'test', name: 'Test', limit: { context: 200000 } } } }], connected: ['opencode'], default: { providerID: 'opencode', modelID: 'test' } },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: 'dev', time: { created: 1700000000000, updated: 1700000000000 } }],
    vcsDiff: [],
    pageMessages: () => ({ items: [assistantToolMessage] }),
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

  // 1) Workspace panel: query + category + location + budget prefills a filtered research_search prompt.
  // Category hotel shows a non-blocking hint; a locations-less hotel query warns but still submits.
  const panel = page.locator('#review-panel')
  await expectAppVisible(panel)
  await panel.getByRole('button', { name: 'Add tab' }).click()
  await page.getByRole('menuitem', { name: 'Research workspace' }).click()
  await expect(panel.getByRole('tab', { name: 'Research' })).toHaveAttribute('data-selected', '')
  await panel.locator('[data-action="research-category"]').selectOption('hotel')
  await expect(panel.locator('[data-action="research-hint"]')).toContainText('location is strongly recommended')
  await panel.locator('[data-action="research-query"]').fill('Bali hotel')
  await expect(panel.locator('[data-action="research-warning"]')).toContainText('Add a location')
  await panel.locator('[data-action="research-location"]').fill('Bali')
  await panel.locator('[data-action="research-budget"]').fill('max 150 USD/night')
  await expect(panel.locator('[data-action="research-warning"]')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Ask Chat to research' }).click()
  const composer = page.locator('[data-component="composer"]')
  await expect(composer.getByText('research_search', { exact: false })).toBeVisible()
  await expect(composer.getByText('Location: Bali.', { exact: false })).toBeVisible()
  await expect(composer.getByText('Budget: max 150 USD/night.', { exact: false })).toBeVisible()
  await expect(composer.getByText('without explicit approval', { exact: false })).toBeVisible()

  // 2) Both card actions only prefill the composer (asking does NOT execute anything).
  // Assert both BEFORE submit: after submit the timeline re-renders and the held card
  // locator goes stale, so Draft must be checked while the card reference is fresh.
  const composerEditor = composer.locator('[data-component="composer-editor"]')
  await composerEditor.fill('')
  await page.getByRole('button', { name: 'Used 1 research_search' }).click()
  const card = page.locator('[data-component="assistant-result-card"]', { hasText: 'Grand Bali' })
  await expectAppVisible(card)
  await card.getByRole('button', { name: 'Shortlist', exact: true }).click()
  await expect(composer.getByText('research_shortlist save', { exact: false })).toBeVisible()
  await expect(composer.getByText('hotel-grand-bali', { exact: false })).toBeVisible()

  // 3) Draft action stays approval-gated: ask-chat prefills the composer, never executes.
  await card.getByRole('button', { name: 'Draft action', exact: true }).click()
  await expect(composer.getByText('action prepare', { exact: false })).toBeVisible()
  await expect(composer.getByText('explicitly approve', { exact: false })).toBeVisible()

  // 4) Send the shortlist prefill last; the model then runs research_shortlist save.
  await card.getByRole('button', { name: 'Shortlist', exact: true }).click()
  await expect(composer.getByText('research_shortlist save', { exact: false })).toBeVisible()
  await composer.locator('[data-action="composer-submit"]').click()
  await expect.poll(() => prompts.length).toBeGreaterThan(0)
  expect(JSON.stringify(prompts[0])).toContain('research_shortlist save')
  expect(errors).toEqual([])
})
