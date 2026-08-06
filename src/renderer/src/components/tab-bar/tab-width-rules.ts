// Why: capped tabs share the strip on a fixed basis; unlimited tabs size from the
// title (flex-basis auto) so long titles stay fully visible until the strip
// overflows. Both variants are complete literals so Tailwind JIT can scan them.
export function getTabContainerWidthClasses(unlimitedWidth: boolean): string {
  return unlimitedWidth
    ? 'min-w-[88px] flex-[1_1_auto]'
    : 'min-w-[88px] max-w-[280px] flex-[1_1_180px] min-[1280px]:flex-[1_1_220px]'
}

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'
