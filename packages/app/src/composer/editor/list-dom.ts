import { getCursorPosition, setCursorPosition } from "./dom"
import { listEdit, type ListEdit, type ListKey } from "./list"

// fork: DOM side of list editing (see list.ts). Edits go through execCommand so the browser keeps native undo and
// fires the usual input events, which re-parse the draft; the caret is restored by text position afterwards.

/** The list key behind a keydown, or undefined when the event is not a list key. */
export function listKeyOf(event: KeyboardEvent): ListKey | undefined {
  if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return undefined
  if (event.key === "Enter" && event.shiftKey) return "shift-enter"
  if (event.key === "Tab") return event.shiftKey ? "shift-tab" : "tab"
  if (event.key === "Backspace" && !event.shiftKey) return "backspace"
  return undefined
}

/** Run the list edit for `key` at the caret. Returns true when it handled the key. */
export function handleListKey(editor: HTMLElement, value: string, key: ListKey) {
  const selection = window.getSelection()
  if (!selection?.isCollapsed || !selection.rangeCount || !editor.contains(selection.anchorNode)) return false
  const edit = listEdit(value, getCursorPosition(editor), key)
  if (!edit) return false
  return applyListEdit(editor, edit)
}

export function applyListEdit(editor: HTMLElement, edit: ListEdit) {
  if (typeof document.execCommand !== "function") return false
  setCursorPosition(editor, edit.at)
  for (let index = 0; index < edit.remove; index++) document.execCommand("forwardDelete")
  if (edit.insert) {
    // A literal newline in a text node survives (white-space: pre-wrap); insertText would start a new block.
    const multiline = edit.insert.includes("\n")
    const text = multiline ? edit.insert.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : edit.insert
    document.execCommand(multiline ? "insertHTML" : "insertText", false, text)
  }
  setCursorPosition(editor, edit.caret)
  return true
}
