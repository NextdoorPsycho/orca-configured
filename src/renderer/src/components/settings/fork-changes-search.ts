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
  },
  {
    title: translate(
      'auto.components.settings.forkChanges.search.titlebarAppNameTitle',
      'App name in titlebar'
    ),
    description: translate(
      'auto.components.settings.forkChanges.search.titlebarAppNameDescription',
      'Show the Orca app name next to the window controls.'
    ),
    keywords: sidebarEntryKeywords(),
    targetSectionId: 'fork-changes-titlebar-app-name'
  },
  {
    title: translate(
      'auto.components.settings.forkChanges.search.sidebarTasksTitle',
      'Tasks in sidebar'
    ),
    description: translate(
      'auto.components.settings.forkChanges.search.sidebarTasksDescription',
      'Show or hide the Tasks entry in the left sidebar.'
    ),
    keywords: sidebarEntryKeywords(),
    targetSectionId: 'fork-changes-sidebar-tasks'
  },
  {
    title: translate(
      'auto.components.settings.forkChanges.search.sidebarAgentsTitle',
      'Agents in sidebar'
    ),
    description: translate(
      'auto.components.settings.forkChanges.search.sidebarAgentsDescription',
      'Show or hide the Agents entry in the left sidebar.'
    ),
    keywords: sidebarEntryKeywords(),
    targetSectionId: 'fork-changes-sidebar-agents'
  },
  {
    title: translate(
      'auto.components.settings.forkChanges.search.sidebarAutomationsTitle',
      'Automations in sidebar'
    ),
    description: translate(
      'auto.components.settings.forkChanges.search.sidebarAutomationsDescription',
      'Show or hide the Automations entry in the left sidebar.'
    ),
    keywords: sidebarEntryKeywords(),
    targetSectionId: 'fork-changes-sidebar-automations'
  }
])

function sidebarEntryKeywords(): string[] {
  return [
    ...translateSearchKeyword('auto.components.settings.forkChanges.search.keywordFork', 'fork'),
    ...translateSearchKeyword(
      'auto.components.settings.forkChanges.search.keywordSidebar',
      'sidebar'
    ),
    ...translateSearchKeyword('auto.components.settings.forkChanges.search.keywordHide', 'hide'),
    ...translateSearchKeyword('auto.components.settings.forkChanges.search.keywordShow', 'show')
  ]
}

// Why: title-keyed lookup throws loudly on a typo/rename instead of silently
// matching the wrong (or empty) entry — mirrors experimental-search.ts.
function findEntry(title: string): SettingsSearchEntry {
  const entry = getForkChangesPaneSearchEntries().find((e) => e.title === title)
  if (!entry) {
    throw new Error(`Missing fork-changes-pane search entry: "${title}"`)
  }
  return entry
}

export function getForkChangesSearchEntry(): {
  unlimitedTabWidth: SettingsSearchEntry
  titlebarAppName: SettingsSearchEntry
  sidebarTasks: SettingsSearchEntry
  sidebarAgents: SettingsSearchEntry
  sidebarAutomations: SettingsSearchEntry
} {
  return {
    unlimitedTabWidth: findEntry(
      translate(
        'auto.components.settings.forkChanges.search.unlimitedTabWidthTitle',
        'Unlimited tab width'
      )
    ),
    titlebarAppName: findEntry(
      translate(
        'auto.components.settings.forkChanges.search.titlebarAppNameTitle',
        'App name in titlebar'
      )
    ),
    sidebarTasks: findEntry(
      translate('auto.components.settings.forkChanges.search.sidebarTasksTitle', 'Tasks in sidebar')
    ),
    sidebarAgents: findEntry(
      translate(
        'auto.components.settings.forkChanges.search.sidebarAgentsTitle',
        'Agents in sidebar'
      )
    ),
    sidebarAutomations: findEntry(
      translate(
        'auto.components.settings.forkChanges.search.sidebarAutomationsTitle',
        'Automations in sidebar'
      )
    )
  } as const
}
