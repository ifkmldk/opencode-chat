/** fork: the opencode-preview / opencode-artifacts plugins serve their canvas on loopback
 * (http://localhost:<port>/#/<id>). When one of their tools finishes during a turn, the app shows that page in a
 * side-panel browser tab instead of the plugin launching a separate browser window. */

// opencode-preview and opencode-artifacts tools; in Code Mode they run inside `execute`.
const CANVAS_TOOLS = ["preview_start", "preview_file", "canvas_open", "artifact_create", "artifact_update"]
const CANVAS_CALL = new RegExp(String.raw`\btools\.(?:${CANVAS_TOOLS.join("|")})\s*\(`)
const LOOPBACK = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/#\/[^\s)"'<>]*)?(?=[\s)"'<>]|$)/g

export function isCanvasTool(tool: string, input: Record<string, unknown> = {}) {
  if (tool === "execute") return typeof input.code === "string" && CANVAS_CALL.test(input.code)
  return CANVAS_TOOLS.includes(tool) && input.open !== false
}

/** The loopback canvas URL in a tool's output: the one after "canvas" (preview_start prints the dev-server URL first). */
export function canvasUrlFrom(output: string | undefined) {
  if (!output) return undefined
  const canvas = output.search(/canvas/i)
  const matches = [...output.matchAll(LOOPBACK)]
  return (matches.find((match) => match.index! > canvas) ?? matches.at(-1))?.[0]
}
