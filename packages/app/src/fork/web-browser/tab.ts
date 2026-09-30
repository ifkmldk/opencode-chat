// fork: layout tab keys for web Browser pane tabs. Dependency-free so tab helpers can import it.
export const WEB_BROWSER_TAB_PREFIX = "web-browser:"

export function isWebBrowserTab(tab: string | undefined) {
  return !!tab?.startsWith(WEB_BROWSER_TAB_PREFIX)
}

export function webBrowserTab(id: string) {
  return `${WEB_BROWSER_TAB_PREFIX}${id}`
}
