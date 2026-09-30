// fork: the runner's completion contract (core/src/session/runner/completion.ts) has the model end a finished
// reply with this marker so it knows not to auto-continue. It is bookkeeping, never shown or copied.
const MARKER = "[[OPENCODE_TASK_COMPLETE]]"

/** The reply without the marker; while streaming, a trailing partial marker is hidden too. */
export function hideCompletionMarker(text: string, streaming = false) {
  const clean = text.includes(MARKER) ? text.replaceAll(MARKER, "").replace(/[ \t]*\n?\s*$/, "") : text
  if (!streaming) return clean
  const tail = clean.lastIndexOf("[[")
  if (tail === -1 || !MARKER.startsWith(clean.slice(tail))) return clean
  return clean.slice(0, tail).trimEnd()
}
