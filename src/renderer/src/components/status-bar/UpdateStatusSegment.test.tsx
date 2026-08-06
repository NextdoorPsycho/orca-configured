// @vitest-environment happy-dom

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../shared/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateStatusSegment } from './UpdateStatusSegment'

const storeState = vi.hoisted(() => ({
  current: {
    updateStatus: { state: 'idle' } as UpdateStatus,
    updateCardCollapsed: false,
    dismissedUpdateVersion: null as string | null,
    setUpdateCardCollapsed: vi.fn(),
    clearDismissedUpdateVersion: vi.fn()
  }
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof storeState.current) => unknown) =>
    selector(storeState.current)
}))

beforeEach(() => {
  storeState.current.updateStatus = { state: 'idle' } as UpdateStatus
  storeState.current.updateCardCollapsed = false
  storeState.current.dismissedUpdateVersion = null
  storeState.current.setUpdateCardCollapsed = vi.fn()
  storeState.current.clearDismissedUpdateVersion = vi.fn()
})

afterEach(() => {
  document.body.innerHTML = ''
})

function markup(): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <UpdateStatusSegment compact={false} iconOnly={false} />
    </TooltipProvider>
  )
}

describe('UpdateStatusSegment', () => {
  it('renders nothing while idle or checking', () => {
    expect(markup()).toBe('')
    storeState.current.updateStatus = { state: 'checking' } as UpdateStatus
    expect(markup()).toBe('')
  })

  it('pulses a crossfading update icon when an update is available', () => {
    storeState.current.updateStatus = {
      state: 'available',
      version: '1.4.174-rc.0.fork.9',
      changelog: null
    } as UpdateStatus

    const html = markup()
    expect(html).toContain('fork-update-pulse')
    expect(html).toContain('Update available')
  })

  it('keeps the downloading percent segment intact', () => {
    storeState.current.updateStatus = {
      state: 'downloading',
      version: '1.4.174-rc.0.fork.9',
      percent: 42
    } as UpdateStatus

    const html = markup()
    expect(html).toContain('42%')
    expect(html).not.toContain('fork-update-pulse')
  })

  it('restores a dismissed update card when the available icon is clicked', async () => {
    storeState.current.updateStatus = {
      state: 'available',
      version: '1.4.174-rc.0.fork.9',
      changelog: null
    } as UpdateStatus
    storeState.current.dismissedUpdateVersion = '1.4.174-rc.0.fork.9'
    storeState.current.updateCardCollapsed = true

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <TooltipProvider>
          <UpdateStatusSegment compact={false} iconOnly={false} />
        </TooltipProvider>
      )
    })

    const button = container.querySelector<HTMLButtonElement>('button')
    if (!button) {
      throw new Error('available segment did not render a button')
    }
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(storeState.current.clearDismissedUpdateVersion).toHaveBeenCalled()
    expect(storeState.current.setUpdateCardCollapsed).toHaveBeenCalledWith(false)
    root.unmount()
  })
})
