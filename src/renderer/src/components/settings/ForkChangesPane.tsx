import type { GlobalSettings } from '../../../../shared/types'
import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { useAppStore } from '../../store'
import { getForkChangesSearchEntry } from './fork-changes-search'
import { matchesSettingsSearch } from './settings-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type ForkChangesPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

type ForkToggleRowProps = {
  entry: SettingsSearchEntry
  id: string
  label: string
  copy: string
  toggleLabel: string
  checked: boolean
  onToggle: (next: boolean) => void
  searchQuery: string
}

function ForkToggleRow({
  entry,
  id,
  label,
  copy,
  toggleLabel,
  checked,
  onToggle,
  searchQuery
}: ForkToggleRowProps): React.JSX.Element | null {
  if (!matchesSettingsSearch(searchQuery, [entry])) {
    return null
  }
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>{label}</Label>
          <p className="text-xs text-muted-foreground">{copy}</p>
        </div>
        <SettingsSwitch
          checked={checked}
          ariaLabel={toggleLabel}
          onChange={() => onToggle(!checked)}
        />
      </div>
    </SearchableSetting>
  )
}

// Fork-only pane: future fork tweaks get added here as more ForkToggleRow entries.
export function ForkChangesPane({
  settings,
  updateSettings
}: ForkChangesPaneProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const entries = getForkChangesSearchEntry()

  return (
    <div className="space-y-4">
      <ForkToggleRow
        entry={entries.unlimitedTabWidth}
        id="fork-changes-unlimited-tab-width"
        label={translate(
          'auto.components.settings.ForkChangesPane.unlimitedTabWidth.title',
          'Unlimited tab width'
        )}
        copy={translate(
          'auto.components.settings.ForkChangesPane.unlimitedTabWidth.copy',
          'Remove the maximum width cap on terminal pane tabs so titles get all the space they need.'
        )}
        toggleLabel={translate(
          'auto.components.settings.ForkChangesPane.unlimitedTabWidth.toggleLabel',
          'Toggle unlimited tab width'
        )}
        checked={settings.experimentalTerminalTabsUnlimitedWidth === true}
        onToggle={(next) => updateSettings({ experimentalTerminalTabsUnlimitedWidth: next })}
        searchQuery={searchQuery}
      />

      <ForkToggleRow
        entry={entries.sidebarTasks}
        id="fork-changes-sidebar-tasks"
        label={translate(
          'auto.components.settings.ForkChangesPane.sidebarTasks.title',
          'Tasks in sidebar'
        )}
        copy={translate(
          'auto.components.settings.ForkChangesPane.sidebarTasks.copy',
          'Show the Tasks entry in the left sidebar.'
        )}
        toggleLabel={translate(
          'auto.components.settings.ForkChangesPane.sidebarTasks.toggleLabel',
          'Toggle the sidebar Tasks entry'
        )}
        checked={settings.showTasksButton !== false}
        onToggle={(next) => updateSettings({ showTasksButton: next })}
        searchQuery={searchQuery}
      />

      <ForkToggleRow
        entry={entries.sidebarAgents}
        id="fork-changes-sidebar-agents"
        label={translate(
          'auto.components.settings.ForkChangesPane.sidebarAgents.title',
          'Agents in sidebar'
        )}
        copy={translate(
          'auto.components.settings.ForkChangesPane.sidebarAgents.copy',
          'Show the Agents entry in the left sidebar while the Agents view is enabled.'
        )}
        toggleLabel={translate(
          'auto.components.settings.ForkChangesPane.sidebarAgents.toggleLabel',
          'Toggle the sidebar Agents entry'
        )}
        checked={settings.showAgentsButton !== false}
        onToggle={(next) => updateSettings({ showAgentsButton: next })}
        searchQuery={searchQuery}
      />

      <ForkToggleRow
        entry={entries.sidebarAutomations}
        id="fork-changes-sidebar-automations"
        label={translate(
          'auto.components.settings.ForkChangesPane.sidebarAutomations.title',
          'Automations in sidebar'
        )}
        copy={translate(
          'auto.components.settings.ForkChangesPane.sidebarAutomations.copy',
          'Show the Automations entry in the left sidebar.'
        )}
        toggleLabel={translate(
          'auto.components.settings.ForkChangesPane.sidebarAutomations.toggleLabel',
          'Toggle the sidebar Automations entry'
        )}
        checked={settings.showAutomationsButton !== false}
        onToggle={(next) => updateSettings({ showAutomationsButton: next })}
        searchQuery={searchQuery}
      />
    </div>
  )
}
