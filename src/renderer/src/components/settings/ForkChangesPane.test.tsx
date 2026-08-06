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
})
