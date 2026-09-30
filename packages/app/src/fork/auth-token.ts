const KEY = "opencode.auth_token"

// fork: the launcher opens the app with ?auth_token=…, which upstream reads once and keeps only in memory, so a
// reload or a service-worker update fell back to the browser's Basic-auth dialog. Keep it for this window's
// session: sessionStorage is per window and cleared when it closes, and the launcher passes it again next time.
export function launcherToken(search: string, storage?: Pick<Storage, "getItem" | "setItem">) {
  const token = new URLSearchParams(search).get("auth_token")
  try {
    const store = storage ?? sessionStorage
    if (token) store.setItem(KEY, token)
    return token ?? store.getItem(KEY)
  } catch {
    // Storage can be blocked (site data disabled); the URL token still works for this load.
    return token
  }
}
