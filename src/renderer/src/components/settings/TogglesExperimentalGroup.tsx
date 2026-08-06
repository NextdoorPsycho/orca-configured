import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { useAppStore } from '../../store'
import { getExperimentalSearchEntry } from './experimental-search'
import { matchesSettingsSearch } from './settings-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'

type TogglesExperimentalGroupProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

// Fork-only section: future toggles go here as more SearchableSetting rows,
// with their entries added to the section-visibility list below.
export function TogglesExperimentalGroup({
  settings,
  updateSettings
}: TogglesExperimentalGroupProps): React.JSX.Element | null {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const unlimitedTabWidthEntry = getExperimentalSearchEntry().unlimitedTabWidth
  const unlimitedTabWidthEnabled = settings.experimentalTerminalTabsUnlimitedWidth === true
  // Hide the section header when no row would survive the settings search.
  if (!matchesSettingsSearch(searchQuery, [unlimitedTabWidthEntry])) {
    return null
  }

  return (
    <section className="w-full max-w-3xl space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold">
          {translate('auto.components.settings.TogglesExperimentalGroup.title', 'Toggles')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.TogglesExperimentalGroup.description',
            'Small behavior tweaks for this fork of Orca.'
          )}
        </p>
      </div>

      <SearchableSetting
        title={unlimitedTabWidthEntry.title}
        description={unlimitedTabWidthEntry.description}
        keywords={unlimitedTabWidthEntry.keywords}
        className="space-y-3 py-2"
        id="experimental-toggles"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 shrink space-y-0.5">
            <Label>
              {translate(
                'auto.components.settings.TogglesExperimentalGroup.unlimitedTabWidth.title',
                'Unlimited tab width'
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.TogglesExperimentalGroup.unlimitedTabWidth.copy',
                'Remove the maximum width cap on terminal pane tabs so titles get all the space they need.'
              )}
            </p>
          </div>
          <SettingsSwitch
            checked={unlimitedTabWidthEnabled}
            ariaLabel={translate(
              'auto.components.settings.TogglesExperimentalGroup.unlimitedTabWidth.toggleLabel',
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
    </section>
  )
}
