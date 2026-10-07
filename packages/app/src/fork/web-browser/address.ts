/** Turn what the user typed into a URL: add a scheme, or search when it is not an address. */
export function webBrowserAddress(input: string) {
  const value = input.trim()
  if (!value) return ""
  // Google answers pages fetched by the server proxy with a bot check, so Google pages load straight from the
  // user's own browser in its embeddable mode (igu=1) instead of through the proxy.
  if (/^(https?:\/\/)?(www\.)?google\.[a-z.]+(\/(search|webhp)?(\?.*)?)?$/i.test(value)) {
    const full = value.startsWith("http") ? value : `https://${value}`
    const query = URL.canParse(full) ? new URL(full).searchParams.get("q") : null
    return googleSearch(query)
  }
  if (/^https?:\/\//i.test(value)) return value
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`
  if (!/\s/.test(value) && /^[^/]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`
  return googleSearch(value)
}

function googleSearch(query: string | null) {
  return query ? `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}` : "https://www.google.com/webhp?igu=1"
}

/** Google's embeddable pages load directly in the frame (never through the proxy). */
export function isDirectFrame(url: string) {
  return URL.canParse(url) && /^www\.google\.[a-z.]+$/.test(new URL(url).hostname) && new URL(url).searchParams.get("igu") === "1"
}
