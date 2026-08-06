// @vitest-environment happy-dom

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import { getDefaultSettings } from '../../../../shared/constants'
import { ForkChangesPane } from './ForkChangesPane'
import { getForkChangesPaneSearchEntries } from './fork-changes-search'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

afterEach(() => {
  document.body.innerHTML = ''
})

async function renderForkChangesPane(args: {
  updateSettings: (settings: Partial<GlobalSettings>) => void
  settings?: GlobalSettings
}): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ForkChangesPane
        settings={args.settings ?? getDefaultSettings('/tmp')}
        updateSettings={args.updateSettings}
      />
    )
  })
  return { root, container }
}

describe('ForkChangesPane', () => {
  it('renders an off-by-default unlimited tab width switch with a search entry', () => {
    const settings = getDefaultSettings('/tmp')
    const markup = renderToStaticMarkup(
      <ForkChangesPane settings={settings} updateSettings={vi.fn()} />
    )
    const entry = getForkChangesPaneSearchEntries().find(
      (searchEntry) => searchEntry.title === 'Unlimited tab width'
    )

    expect(settings.experimentalTerminalTabsUnlimitedWidth).toBe(false)
    expect(markup).toContain('Unlimited tab width')
    expect(markup).toContain('aria-checked="false"')
    expect(getForkChangesPaneSearchEntries().map((searchEntry) => searchEntry.title)).toContain(
      'Unlimited tab width'
    )
    expect(entry?.targetSectionId).toBe('fork-changes-unlimited-tab-width')
  })

  it('enables unlimited tab width through its switch', async () => {
    const updateSettings = vi.fn()
    const { root, container } = await renderForkChangesPane({ updateSettings })

    const switchButton = container.querySelector<HTMLButtonElement>(
      '#fork-changes-unlimited-tab-width button[role="switch"]'
    )
    if (!switchButton) {
      throw new Error('Unlimited tab width switch was not rendered')
    }

    await act(async () => {
      switchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(updateSettings).toHaveBeenCalledWith({ experimentalTerminalTabsUnlimitedWidth: true })
    root.unmount()
  })

  it('renders the three sidebar-entry switches on by default with search entries', () => {
    const markup = renderToStaticMarkup(
      <ForkChangesPane settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />
    )
    const titles = getForkChangesPaneSearchEntries().map((searchEntry) => searchEntry.title)

    for (const title of ['Tasks in sidebar', 'Agents in sidebar', 'Automations in sidebar']) {
      expect(markup).toContain(title)
      expect(titles).toContain(title)
    }
    // Three sidebar switches on; the only off switch is unlimited tab width.
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(3)
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(1)
  })

  async function clickSwitch(rowId: string): Promise<ReturnType<typeof vi.fn>> {
    const updateSettings = vi.fn()
    const { root, container } = await renderForkChangesPane({ updateSettings })
    const switchButton = container.querySelector<HTMLButtonElement>(
      `#${rowId} button[role="switch"]`
    )
    if (!switchButton) {
      throw new Error(`${rowId} switch was not rendered`)
    }
    await act(async () => {
      switchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    root.unmount()
    return updateSettings
  }

  it('turns each sidebar entry off through its switch', async () => {
    expect(await clickSwitch('fork-changes-sidebar-tasks')).toHaveBeenCalledWith({
      showTasksButton: false
    })
    expect(await clickSwitch('fork-changes-sidebar-agents')).toHaveBeenCalledWith({
      showAgentsButton: false
    })
    expect(await clickSwitch('fork-changes-sidebar-automations')).toHaveBeenCalledWith({
      showAutomationsButton: false
    })
  })

  it('turns a hidden sidebar entry back on', async () => {
    const updateSettings = vi.fn()
    const { root, container } = await renderForkChangesPane({
      updateSettings,
      settings: { ...getDefaultSettings('/tmp'), showTasksButton: false }
    })
    const switchButton = container.querySelector<HTMLButtonElement>(
      '#fork-changes-sidebar-tasks button[role="switch"]'
    )
    if (!switchButton) {
      throw new Error('Tasks switch was not rendered')
    }
    expect(switchButton.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      switchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(updateSettings).toHaveBeenCalledWith({ showTasksButton: true })
    root.unmount()
  })
})
