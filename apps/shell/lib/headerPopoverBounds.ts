export function headerPopoverBounds({
  anchorRight, anchorBottom, anchorHeight, viewportWidth, viewportBottom,
  navigationTop, rootFontSize, preferredWidthRem = 22,
}: {
  anchorRight: number;
  anchorBottom: number;
  anchorHeight: number;
  viewportWidth: number;
  viewportBottom: number;
  navigationTop?: number;
  rootFontSize: number;
  preferredWidthRem?: number;
}) {
  const gap = 8;
  const bottom = Math.min(viewportBottom, navigationTop ?? viewportBottom);
  return {
    top: anchorHeight + gap,
    width: Math.max(0, Math.min(preferredWidthRem * rootFontSize, viewportWidth - 2 * gap, anchorRight - gap)),
    maxHeight: Math.max(0, bottom - anchorBottom - 2 * gap),
  };
}
