// fork: list editing for the prompt composer (Claude-style). The composer is a plain-text contenteditable, so a list is
// just lines such as "1. item" or "  - nested". Enter keeps sending the message; these keys edit lists instead:
//   Shift+Enter  continue the list (next number or bullet, same indent); on an empty item, leave the list
//   Tab          indent a list item by two spaces (a nested numbered list restarts at 1)
//   Shift+Tab    outdent (a numbered item continues the numbering of its new level)
//   Backspace    right after the marker: outdent first, then remove the marker
// Everything here is pure text -> edit, so it is unit tested without a DOM.

const MARKER = /^(\s*)([-*•]|\d+[.)])(\s+)/
const STEP = "  "

export type ListKey = "shift-enter" | "tab" | "shift-tab" | "backspace"

/** Replace `remove` characters at `at` with `insert`, then put the caret at `caret` (a position in the new text). */
export type ListEdit = { at: number; remove: number; insert: string; caret: number }

type Line = { start: number; text: string }

function lineAt(value: string, cursor: number): Line {
  const start = value.lastIndexOf("\n", cursor - 1) + 1
  const end = value.indexOf("\n", cursor)
  return { start, text: value.slice(start, end === -1 ? value.length : end) }
}

function parse(text: string) {
  const match = MARKER.exec(text)
  if (!match) return undefined
  const marker = match[2]!
  const numbered = /^\d/.test(marker)
  return {
    indent: match[1]!,
    marker,
    gap: match[3]!,
    prefix: match[0],
    rest: text.slice(match[0].length),
    numbered,
    number: numbered ? Number.parseInt(marker, 10) : undefined,
    delimiter: numbered ? marker.slice(-1) : undefined,
  }
}

/** The number a numbered item at `indent` should carry, from the previous sibling above `start` (1 when none). */
function numberAbove(value: string, start: number, indent: number) {
  const lines = value.slice(0, Math.max(0, start - 1)).split("\n")
  for (let index = lines.length - 1; index >= 0; index--) {
    const item = parse(lines[index]!)
    if (!item) {
      if (lines[index]!.trim() === "") return 1
      continue
    }
    if (item.indent.length < indent) return 1
    if (item.indent.length === indent && item.numbered) return item.number! + 1
  }
  return 1
}

function remarker(item: NonNullable<ReturnType<typeof parse>>, indent: string, number: number | undefined) {
  const marker = item.numbered ? `${number ?? item.number}${item.delimiter}` : item.marker
  return `${indent}${marker}${item.gap}`
}

export function listEdit(value: string, cursor: number, key: ListKey): ListEdit | undefined {
  const line = lineAt(value, cursor)
  const item = parse(line.text)
  if (!item) return undefined
  const offset = cursor - line.start

  if (key === "shift-enter") {
    // Inside the marker, a newline would break it apart: leave that to the browser.
    if (offset < item.prefix.length) return undefined
    // An empty item ends the list: clear the line instead of adding another marker.
    if (item.rest.trim() === "" && cursor === line.start + line.text.length)
      return { at: line.start, remove: line.text.length, insert: "", caret: line.start }
    const next = remarker(item, item.indent, item.numbered ? item.number! + 1 : undefined)
    return { at: cursor, remove: 0, insert: `\n${next}`, caret: cursor + 1 + next.length }
  }

  if (key === "tab") {
    const indent = item.indent + STEP
    const next = remarker(item, indent, item.numbered ? 1 : undefined)
    return { at: line.start, remove: item.prefix.length, insert: next, caret: Math.max(line.start + next.length, cursor - item.prefix.length + next.length) }
  }

  if (key === "shift-tab") {
    if (item.indent.length === 0) return undefined
    const indent = item.indent.slice(Math.min(STEP.length, item.indent.length))
    const next = remarker(item, indent, item.numbered ? numberAbove(value, line.start, indent.length) : undefined)
    return { at: line.start, remove: item.prefix.length, insert: next, caret: Math.max(line.start + next.length, cursor - item.prefix.length + next.length) }
  }

  // Backspace only acts directly behind the marker, so it never eats text.
  if (offset !== item.prefix.length) return undefined
  if (item.indent.length > 0) return listEdit(value, cursor, "shift-tab")
  return { at: line.start, remove: item.prefix.length, insert: "", caret: line.start }
}

export function applyEdit(value: string, edit: ListEdit) {
  return value.slice(0, edit.at) + edit.insert + value.slice(edit.at + edit.remove)
}
