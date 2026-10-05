export * as NetGuard from "./net-guard.js"

import dns from "node:dns/promises"
import net from "node:net"

// fork: agent tools that fetch URLs (webfetch, scrape_fetch) must not reach the owner's own machine or network. Text in a
// page or file can talk the model into fetching http://127.0.0.1:20128 (the local model gateway), the cloud metadata
// address, or this server. Public destinations pass; private ones are refused unless the owner allows them on purpose:
//   OPENCODE_FETCH_ALLOW_PRIVATE=1            allow everything (development machines)
//   OPENCODE_FETCH_ALLOW_HOSTS=localhost:3000 allow specific hosts (or host:port), comma separated

export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0]!
  const kind = net.isIP(ip)
  if (kind === 4) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    if (lower === "::" || lower === "::1") return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1]
    if (mapped) return isPrivateAddress(mapped)
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
    if (hexMapped) {
      const high = parseInt(hexMapped[1]!, 16)
      const low = parseInt(hexMapped[2]!, 16)
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
    }
    return (
      /^f[cd][0-9a-f]{2}:/.test(lower) ||
      /^fe[89ab][0-9a-f]:/.test(lower) ||
      /^fe[c-f][0-9a-f]:/.test(lower) ||
      lower.startsWith("ff") ||
      lower.startsWith("64:ff9b:") ||
      lower.startsWith("2001:db8:") ||
      lower.startsWith("2001::") ||
      lower.startsWith("2002:")
    )
  }
  return false
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i

/** Throws an Error with an actionable message when `raw` points at a private, loopback or link-local destination. */
export async function assertPublicUrl(raw: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.OPENCODE_FETCH_ALLOW_PRIVATE === "1") return
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const allowed = (env.OPENCODE_FETCH_ALLOW_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.includes(host.toLowerCase()) || allowed.includes(url.host.toLowerCase())) return
  const refuse = (why: string) =>
    new Error(
      `Refusing to fetch ${url.host}: ${why}. Tools may only read public websites. If the owner wants this, they can set OPENCODE_FETCH_ALLOW_HOSTS=${url.host} (or OPENCODE_FETCH_ALLOW_PRIVATE=1). Tell the user instead of trying another way in.`,
    )
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw refuse("it is a private or loopback address")
    return
  }
  if (LOCAL_NAME.test(host)) throw refuse("it is a local network name")
  const resolved = await dns.lookup(host, { all: true }).catch(() => [])
  if (resolved.some((entry) => isPrivateAddress(entry.address))) throw refuse("its name resolves to a private address")
}
