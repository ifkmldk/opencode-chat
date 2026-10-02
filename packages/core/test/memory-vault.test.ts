import { describe, expect, test } from "bun:test"
import { emptySync, filename, fromMarkdown, hashFile, toMarkdown } from "../src/memory/obsidian-sync.js"

describe("obsidian vault sync", () => {
  test("round-trips entries through markdown frontmatter", () => {
    const entry = { id: "abc123", kind: "fact", scope: "global", title: "Pref", body: "Likes terse answers.", updated: 123, source: "user" }
    const raw = toMarkdown(entry)
    expect(raw).toContain("id: abc123")
    const back = fromMarkdown("abc123", raw)
    expect(back).toMatchObject({ id: "abc123", kind: "fact", scope: "global", body: "Likes terse answers." })
  })

  test("rejects mismatched ids and hashes deterministically", () => {
    const raw = toMarkdown({ id: "a", kind: "fact", scope: "global", title: "t", body: "b", updated: 1, source: "agent" })
    expect(fromMarkdown("b", raw)).toBeUndefined()
    expect(hashFile(raw)).toBe(hashFile(raw))
    expect(filename({ id: "a" })).toBe("entries/a.md")
    expect(emptySync("/vault").files).toEqual({})
  })
})
