import { describe, expect, it } from 'vitest'
import { getTabContainerWidthClasses } from './tab-width-rules'

describe('getTabContainerWidthClasses', () => {
  it('returns the capped width classes when unlimited width is off', () => {
    expect(getTabContainerWidthClasses(false)).toBe(
      'min-w-[88px] max-w-[280px] flex-[1_1_180px] min-[1280px]:flex-[1_1_220px]'
    )
  })

  it('sizes tabs by title need with only the readable floor when unlimited width is on', () => {
    expect(getTabContainerWidthClasses(true)).toBe('min-w-[88px] flex-[1_1_auto]')
  })

  it('keeps the readable minimum width in both variants', () => {
    expect(getTabContainerWidthClasses(false)).toContain('min-w-[88px]')
    expect(getTabContainerWidthClasses(true)).toContain('min-w-[88px]')
  })
})
