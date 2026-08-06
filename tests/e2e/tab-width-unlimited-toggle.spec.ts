/**
 * E2E for the Fork Changes > "Unlimited tab width" setting
 * (experimentalTerminalTabsUnlimitedWidth): enabling it live must let a
 * long-titled terminal tab widen past the default max-w-[280px] cap, and
 * disabling it must restore the cap without a reload. Store calls are setup
 * only (long custom title, settings writes); assertions target rendered tab
 * geometry per tests/e2e/AGENTS.md.
 */

import { test, expect } from './helpers/orca-app'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from './helpers/store'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'
// Needs to render wider than the 280px cap so capped vs uncapped is unambiguous.
const LONG_TITLE = 'a really long terminal tab title that needs far more than the capped width'
const CAPPED_MAX_PX = 281
const UNCAPPED_MIN_PX = 320

async function renderedTabWidth(page: Page, tabId: string): Promise<number> {
  const box = await page.locator(`${SORTABLE_TAB}[data-tab-id="${tabId}"]`).first().boundingBox()
  if (!box) {
    throw new Error(`tab ${tabId} has no bounding box`)
  }
  return box.width
}

async function setUnlimitedTabWidth(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(async (value) => {
    await window.__store?.getState().updateSettings({
      experimentalTerminalTabsUnlimitedWidth: value
    })
  }, enabled)
}

test.describe('Unlimited tab width toggle', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('toggling the setting uncaps and recaps a long-titled tab live', async ({ orcaPage }) => {
    const tabId = await getActiveTabId(orcaPage)
    if (!tabId) {
      throw new Error('no active tab')
    }

    await orcaPage.evaluate(
      ({ id, title }) => window.__store?.getState().setTabCustomTitle(id, title),
      { id: tabId, title: LONG_TITLE }
    )

    // Default (capped): the long title cannot push the tab past the cap.
    await expect
      .poll(() => renderedTabWidth(orcaPage, tabId), { timeout: 5_000 })
      .toBeLessThanOrEqual(CAPPED_MAX_PX)

    await setUnlimitedTabWidth(orcaPage, true)
    await expect
      .poll(() => renderedTabWidth(orcaPage, tabId), { timeout: 5_000 })
      .toBeGreaterThan(UNCAPPED_MIN_PX)

    await setUnlimitedTabWidth(orcaPage, false)
    await expect
      .poll(() => renderedTabWidth(orcaPage, tabId), { timeout: 5_000 })
      .toBeLessThanOrEqual(CAPPED_MAX_PX)
  })

  test('the Fork Changes row is searchable and its switch flips the setting', async ({
    orcaPage
  }, testInfo) => {
    await orcaPage.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      // Why: assertions below are on English strings; 'system' would follow the host locale.
      await store.getState().updateSettings({ uiLanguage: 'en' })
      store.getState().openSettingsPage()
    })

    const searchInput = orcaPage.getByPlaceholder('Search settings')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('unlimited tab width')

    await orcaPage.getByText('Fork Changes', { exact: true }).first().click()

    const row = orcaPage.locator('#fork-changes-unlimited-tab-width')
    await expect(row.getByText('Unlimited tab width', { exact: true }).first()).toBeVisible()

    const switchButton = row.locator('button[role="switch"]')
    await expect(switchButton).toHaveAttribute('aria-checked', 'false')
    await switchButton.click()
    await expect(switchButton).toHaveAttribute('aria-checked', 'true')

    const persisted = await orcaPage.evaluate(
      () => window.__store?.getState().settings?.experimentalTerminalTabsUnlimitedWidth
    )
    expect(persisted).toBe(true)

    await testInfo.attach('fork-changes-section', {
      body: await orcaPage.screenshot(),
      contentType: 'image/png'
    })
  })
})
