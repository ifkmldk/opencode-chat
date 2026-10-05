/** Turn what the user typed into a URL: add a scheme, or search when it is not an address. */
export function webBrowserAddress(input: string) {
  const value = input.trim()
  if (!value) return ""
  // Google answers pages fetched by the server proxy with a bot check, so its searches open on Bing with the same words.
  if (/^(https?:\/\/)?(www\.)?google\.[a-z.]+(\/(search)?(\?.*)?)?$/i.test(value)) {
    const full = value.startsWith("http") ? value : `https://${value}`
    const query = URL.canParse(full) ? new URL(full).searchParams.get("q") : null
    return query ? `https://www.bing.com/search?q=${encodeURIComponent(query)}` : "https://www.bing.com/"
  }
  if (/^https?:\/\//i.test(value)) return value
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return `http://${value}`
  if (!/\s/.test(value) && /^[^/]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`
}
