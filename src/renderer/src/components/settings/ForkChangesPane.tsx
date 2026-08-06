import type { GlobalSettings } from '../../../../shared/types'
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

// Fork-only pane: future fork tweaks get added here as more SearchableSetting rows.
export function ForkChangesPane({
  settings,
  updateSettings
}: ForkChangesPaneProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const unlimitedTabWidthEntry = getForkChangesSearchEntry().unlimitedTabWidth
  const showUnlimitedTabWidth = matchesSettingsSearch(searchQuery, [unlimitedTabWidthEntry])
  const unlimitedTabWidthEnabled = settings.experimentalTerminalTabsUnlimitedWidth === true

  return (
    <div className="space-y-4">
      {showUnlimitedTabWidth ? (
        <SearchableSetting
          title={unlimitedTabWidthEntry.title}
          description={unlimitedTabWidthEntry.description}
          keywords={unlimitedTabWidthEntry.keywords}
          className="space-y-3 py-2"
          id="fork-changes-unlimited-tab-width"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 shrink space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.ForkChangesPane.unlimitedTabWidth.title',
                  'Unlimited tab width'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.ForkChangesPane.unlimitedTabWidth.copy',
                  'Remove the maximum width cap on terminal pane tabs so titles get all the space they need.'
                )}
              </p>
            </div>
            <SettingsSwitch
              checked={unlimitedTabWidthEnabled}
              ariaLabel={translate(
                'auto.components.settings.ForkChangesPane.unlimitedTabWidth.toggleLabel',
                'Toggle unlimited tab width'
              )}
              onChange={() =>
                updateSettings({
                  experimentalTerminalTabsUnlimitedWidth: !unlimitedTabWidthEnabled
                })
              }
            />
          </div>
        </SearchableSetting>
      ) : null}
    </div>
  )
}
