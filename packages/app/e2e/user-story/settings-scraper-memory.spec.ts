import { expect, test } from '@playwright/test'
import { mockOpenCodeServer } from '../utils/mock-server'
import { trackPageErrors } from '../utils/errors'
import { expectAppVisible } from '../utils/waits'

const directory = 'C:/Projects/settings-demo'

test.use({ viewport: { width: 1440, height: 1000 } })

// fork: Settings → Scraper + Memory tabs render with the same SettingsList/Row
// structure as Maps, and their controls persist locally across reloads.
test('settings scraper and memory tabs persist controls', async ({ page }) => {
  const errors = trackPageErrors(page)
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: 'proj_settings_demo',
      canonical: directory,
      name: 'Settings demo',
      vcs: 'git',
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      'opencode.global.dat:server',
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
    )
  }, directory)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByTestId('settings-screen')
  await expectAppVisible(settings.getByRole('tab', { name: 'Preferences' }))

  // Scraper tab: mode select + engine rows exist.
  await settings.getByRole('tab', { name: 'Scraper' }).click()
  await expect(page.locator('[data-action="settings-scraper-mode"]')).toBeVisible()
  await expect(page.locator('[data-action="settings-scraper-install-camofox"]')).toBeVisible()

  // Memory tab: vault dir input exists and persists what we type.
  await settings.getByRole('tab', { name: 'Memory' }).click()
  const vault = page.locator('[data-action="settings-memory-vault-dir"] input')
  await expect(vault).toBeVisible()
  await vault.fill('C:/vault-test')
  await page.reload()
  const settingsAfter = page.getByTestId('settings-screen')
  await expectAppVisible(settingsAfter.getByRole('tab', { name: 'Preferences' }))
  await settingsAfter.getByRole('tab', { name: 'Memory' }).click()
  await expect(page.locator('[data-action="settings-memory-vault-dir"] input')).toHaveValue('C:/vault-test')

  expect(errors).toEqual([])
})
