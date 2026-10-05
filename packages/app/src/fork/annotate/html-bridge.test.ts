import { describe, expect, test } from "bun:test"
import { injectSelectionBridge, readSelectionMessage, sourceLines } from "./html-bridge"

describe("html preview bridge", () => {
  test("injects the script into head, html, or the start of a fragment", () => {
    expect(injectSelectionBridge("<html><head><title>x</title></head><body>a</body></html>")).toMatch(/<head><script>/)
    expect(injectSelectionBridge("<html><body>a</body></html>")).toMatch(/<html><head><script>.*<\/script><\/head><body>/s)
    expect(injectSelectionBridge("<p>a</p>").startsWith("<head><script>")).toBe(true)
  })

  test("reads selection messages and ignores other messages", () => {
    expect(readSelectionMessage({ opencodeArtifactSelection: null })).toBeNull()
    expect(readSelectionMessage({ other: 1 })).toBeUndefined()
    expect(readSelectionMessage({ opencodeArtifactSelection: { text: "  ", rect: {} } })).toBeUndefined()
    expect(
      readSelectionMessage({ opencodeArtifactSelection: { text: "hello", html: "<p>hello</p>", rect: { x: 1, y: 2, width: 3, height: 4 } } }),
    ).toEqual({ text: "hello", html: "<p>hello</p>", rect: { x: 1, y: 2, width: 3, height: 4 } })
  })

  test("maps selected text back to source lines through tags and whitespace", () => {
    const source = ["<html>", "<body>", "<h1>Title</h1>", "<p>First <b>bold</b>", "  part of text</p>", "<p>Last one</p>", "</body>", "</html>"].join("\n")
    expect(sourceLines(source, "Title")).toEqual({ start: 3, end: 3 })
    expect(sourceLines(source, "First bold part of text")).toEqual({ start: 4, end: 5 })
    expect(sourceLines(source, "Title First bold part of text Last one")).toEqual({ start: 3, end: 6 })
    expect(sourceLines(source, "not in the file")).toBeUndefined()
  })
})
