// A new WebContentsView has no renderer widget until its first document loads.
export function canEmulate(rendererReady: boolean, destroyed: boolean): boolean {
  return rendererReady && !destroyed
}

export function shouldQuitAfterWindowsClosed(mainWindowOpen: boolean): boolean {
  return !mainWindowOpen
}
