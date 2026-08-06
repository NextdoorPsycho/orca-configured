import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getTogglesExperimentalSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.experimental.search.toggles.unlimitedTabWidthTitle',
      'Unlimited tab width'
    ),
    description: translate(
      'auto.components.settings.experimental.search.toggles.unlimitedTabWidthDescription',
      'Remove the maximum width cap on terminal pane tabs so titles get all the space they need.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.toggles.keywordToggles',
        'toggles'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.toggles.keywordTabs',
        'tabs'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.toggles.keywordTabWidth',
        'tab width'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.toggles.keywordUnlimited',
        'unlimited'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.9bb3bd5098',
        'terminal'
      )
    ],
    targetSectionId: 'experimental-toggles'
  }
}
