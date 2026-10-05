import { describe, expect, test } from "bun:test"
import { ShellTool } from "../src/tool/plugin/shell.js"

// fork: per-shell syntax guidance so the model stops sending bash syntax to PowerShell.
describe("shell syntax hint", () => {
  test("Windows PowerShell 5.1 forbids && and nested powershell -Command", () => {
    const hint = ShellTool.syntaxHint("powershell")!
    expect(hint).toContain("5.1")
    expect(hint).toContain("`;`")
    expect(hint).toContain("powershell -Command")
  })

  test("PowerShell 7 and cmd have their own hints", () => {
    expect(ShellTool.syntaxHint("pwsh")).toContain("PowerShell 7")
    expect(ShellTool.syntaxHint("cmd")).toContain("%NAME%")
  })

  test("unknown shells get no hint", () => {
    expect(ShellTool.syntaxHint("fish")).toBeUndefined()
  })
})
