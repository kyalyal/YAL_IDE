export function clampSidebarWidth(width: number, windowWidth: number): number {
  const requested = Number.isFinite(width) ? width : 260
  // Preserve the usable minimum on narrow windows, as clampViewerWidth does.
  return Math.max(180, Math.min(requested, 480, windowWidth * .4))
}

export function clampSpaceRatio(ratio: number): number {
  return Math.max(.15, Math.min(Number.isFinite(ratio) ? ratio : .4, .85))
}

function storedNumber(value: string | null): number {
  return value === null || value.trim() === '' ? NaN : Number(value)
}

export function parseSidebarWidth(value: string | null, windowWidth: number): number {
  return clampSidebarWidth(storedNumber(value), windowWidth)
}

export function parseSpaceRatio(value: string | null): number {
  return clampSpaceRatio(storedNumber(value))
}
