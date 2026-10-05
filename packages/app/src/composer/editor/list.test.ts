import { describe, expect, test } from "bun:test"
import { applyEdit, listEdit, type ListKey } from "./list"

// `|` marks the caret.
function run(input: string, key: ListKey) {
  const cursor = input.indexOf("|")
  const value = input.replace("|", "")
  const edit = listEdit(value, cursor, key)
  if (!edit) return undefined
  const next = applyEdit(value, edit)
  return next.slice(0, edit.caret) + "|" + next.slice(edit.caret)
}

describe("composer list editing", () => {
  test("Shift+Enter continues a bullet and a numbered list", () => {
    expect(run("- one|", "shift-enter")).toBe("- one\n- |")
    expect(run("1. one|", "shift-enter")).toBe("1. one\n2. |")
    expect(run("9) nine|", "shift-enter")).toBe("9) nine\n10) |")
    expect(run("  - nested|", "shift-enter")).toBe("  - nested\n  - |")
  })

  test("Shift+Enter in the middle splits the item and keeps the rest", () => {
    expect(run("- ab|cd", "shift-enter")).toBe("- ab\n- |cd")
  })

  test("Shift+Enter on an empty item leaves the list", () => {
    expect(run("- one\n- |", "shift-enter")).toBe("- one\n|")
    expect(run("1. a\n2. |", "shift-enter")).toBe("1. a\n|")
  })

  test("not a list line or caret inside the marker: left to the browser", () => {
    expect(run("plain text|", "shift-enter")).toBeUndefined()
    expect(run("-|one", "shift-enter")).toBeUndefined()
    expect(run("-one|", "tab")).toBeUndefined()
    expect(run("no list|", "backspace")).toBeUndefined()
  })

  test("Tab indents by two spaces and restarts nested numbering", () => {
    expect(run("- item|", "tab")).toBe("  - item|")
    expect(run("1. a\n2. b|", "tab")).toBe("1. a\n  1. b|")
  })

  test("Shift+Tab outdents and continues the numbering above", () => {
    expect(run("  - item|", "shift-tab")).toBe("- item|")
    expect(run("1. a\n2. b\n  1. c\n  2. d\n3. |x", "shift-tab")).toBeUndefined()
    expect(run("1. a\n2. b\n  1. c|", "shift-tab")).toBe("1. a\n2. b\n3. c|")
  })

  test("Backspace behind the marker outdents, then removes the marker, and never eats text", () => {
    expect(run("  - |item", "backspace")).toBe("- |item")
    expect(run("- |item", "backspace")).toBe("|item")
    expect(run("- it|em", "backspace")).toBeUndefined()
  })
})
