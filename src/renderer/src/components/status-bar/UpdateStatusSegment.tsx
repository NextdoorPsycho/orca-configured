import React from 'react'
import { AlertCircle, CheckCircle2, Download } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'

// Why: always rendered (not gated by `statusBarItems`). When the update card
// is collapsed, this segment is the only way back to it — hiding it would
// strand the user with an orphaned download or install.
export function UpdateStatusSegment({
  iconOnly
}: {
  compact: boolean
  iconOnly: boolean
}): React.JSX.Element | null {
  const status = useAppStore((s) => s.updateStatus)
  const collapsed = useAppStore((s) => s.updateCardCollapsed)
  const setCollapsed = useAppStore((s) => s.setUpdateCardCollapsed)
  const clearDismissedUpdateVersion = useAppStore((s) => s.clearDismissedUpdateVersion)

  // Fork: 'available' pulses a subtle white/black crossfade icon here; clicking
  // it re-surfaces the update card even after a dismissal.
  if (status.state === 'available') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              clearDismissedUpdateVersion()
              setCollapsed(false)
            }}
            className="inline-flex items-center gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-accent/70"
            aria-label={translate(
              'auto.components.status.bar.UpdateStatusSegment.availableAria',
              'Update available. Click to open the update prompt.'
            )}
          >
            <Download className="fork-update-pulse size-3" />
            {!iconOnly && (
              <span className="text-[11px]">
                {translate(
                  'auto.components.status.bar.UpdateStatusSegment.availableLabel',
                  'Update available'
                )}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {translate(
            'auto.components.status.bar.UpdateStatusSegment.availableTooltip',
            'Orca v{{value0}} is available — click to update',
            { value0: status.version }
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (status.state !== 'downloading' && status.state !== 'downloaded' && status.state !== 'error') {
    return null
  }

  const segment = (() => {
    if (status.state === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(status.percent)))
      return {
        icon: <Download className="size-3 text-muted-foreground" />,
        label: `${pct}%`,
        tooltip: translate(
          'auto.components.status.bar.UpdateStatusSegment.248ee5d8ef',
          'Orca v{{value0}} downloading… {{value1}}%',
          { value0: status.version, value1: pct }
        ),
        ariaLabel: translate(
          'auto.components.status.bar.UpdateStatusSegment.fd1d3b3a1d',
          'Update downloading, {{value0}} percent. Click to expand.',
          { value0: pct }
        )
      }
    }
    if (status.state === 'downloaded') {
      return {
        icon: <CheckCircle2 className="size-3 text-emerald-500" />,
        label: translate(
          'auto.components.status.bar.UpdateStatusSegment.57a29c3b0e',
          'Update ready'
        ),
        tooltip: translate(
          'auto.components.status.bar.UpdateStatusSegment.9d13213a56',
          'Orca v{{value0}} ready to install',
          { value0: status.version }
        ),
        ariaLabel: translate(
          'auto.components.status.bar.UpdateStatusSegment.962404f68e',
          'Update ready to install. Click to expand.'
        )
      }
    }
    return {
      icon: <AlertCircle className="size-3 text-yellow-500" />,
      label: translate(
        'auto.components.status.bar.UpdateStatusSegment.8533c12c3c',
        'Update failed'
      ),
      tooltip: translate(
        'auto.components.status.bar.UpdateStatusSegment.2201df6987',
        'Update failed — click to see details'
      ),
      ariaLabel: translate(
        'auto.components.status.bar.UpdateStatusSegment.5cd13105a3',
        'Update failed. Click to expand.'
      )
    }
  })()

  const handleClick = () => {
    setCollapsed(!collapsed)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-accent/70"
          aria-label={segment.ariaLabel}
          aria-expanded={!collapsed}
        >
          {segment.icon}
          {!iconOnly && <span className="text-[11px] tabular-nums">{segment.label}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {segment.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
