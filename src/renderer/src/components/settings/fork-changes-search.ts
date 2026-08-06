import type { SettingsSearchEntry } from './settings-search'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getForkChangesPaneSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate(
      'auto.components.settings.forkChanges.search.unlimitedTabWidthTitle',
      'Unlimited tab width'
    ),
    description: translate(
      'auto.components.settings.forkChanges.search.unlimitedTabWidthDescription',
      'Remove the maximum width cap on terminal pane tabs so titles get all the space they need.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.forkChanges.search.keywordFork', 'fork'),
      ...translateSearchKeyword(
        'auto.components.settings.forkChanges.search.keywordToggles',
        'toggles'
      ),
      ...translateSearchKeyword('auto.components.settings.forkChanges.search.keywordTabs', 'tabs'),
      ...translateSearchKeyword(
        'auto.components.settings.forkChanges.search.keywordTabWidth',
        'tab width'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.forkChanges.search.keywordUnlimited',
        'unlimited'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.forkChanges.search.keywordTerminal',
        'terminal'
      )
    ],
    targetSectionId: 'fork-changes-unlimited-tab-width'
  }
])

// Why: title-keyed lookup throws loudly on a typo/rename instead of silently
// matching the wrong (or empty) entry — mirrors experimental-search.ts.
function findEntry(title: string): SettingsSearchEntry {
  const entry = getForkChangesPaneSearchEntries().find((e) => e.title === title)
  if (!entry) {
    throw new Error(`Missing fork-changes-pane search entry: "${title}"`)
  }
  return entry
}

export function getForkChangesSearchEntry(): { unlimitedTabWidth: SettingsSearchEntry } {
  return {
    unlimitedTabWidth: findEntry(
      translate(
        'auto.components.settings.forkChanges.search.unlimitedTabWidthTitle',
        'Unlimited tab width'
      )
    )
  } as const
}
