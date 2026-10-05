import { describe, expect, test } from "bun:test"
import path from "node:path"
import { writeAllowed } from "../src/filesystem"

describe("filesystem write scope", () => {
  const roots = [path.resolve("/work/project"), path.resolve("/tmp/opencode")]

  test("allows files inside the project and the server tmp folder", () => {
    expect(writeAllowed(path.resolve("/work/project/src/a.ts"), roots)).toBe(true)
    expect(writeAllowed(path.resolve("/tmp/opencode/staged/x.csv"), roots)).toBe(true)
    expect(writeAllowed(path.resolve("/work/project"), roots)).toBe(true)
  })

  test("refuses other folders, lookalike prefixes and traversal", () => {
    expect(writeAllowed(path.resolve("/work/project-evil/a.ts"), roots)).toBe(false)
    expect(writeAllowed(path.resolve("/work/project/../secrets/a"), roots)).toBe(false)
    expect(writeAllowed(path.resolve("/etc/passwd"), roots)).toBe(false)
    expect(writeAllowed(path.resolve("/home/me/.config/opencode/hooks.json"), roots)).toBe(false)
  })
})
