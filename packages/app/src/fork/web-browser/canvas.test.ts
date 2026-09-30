import { describe, expect, test } from "bun:test"
import { canvasUrlFrom, isCanvasTool } from "./canvas"

describe("canvasUrlFrom", () => {
  test("reads preview_file output", () => {
    expect(canvasUrlFrom("Shown in canvas (v2): http://localhost:51230/#/abc123")).toBe("http://localhost:51230/#/abc123")
  })

  test("prefers the canvas URL over the dev server URL", () => {
    const output = "Live preview: http://localhost:5173 (vite)\nCanvas: http://localhost:51230/#/dev1\nLog: C:/x.log"
    expect(canvasUrlFrom(output)).toBe("http://localhost:51230/#/dev1")
  })

  test("reads canvas_open output without an item", () => {
    expect(canvasUrlFrom("Canvas opened: http://localhost:51230 (2 item(s))")).toBe("http://localhost:51230")
  })

  test("ignores non-loopback and missing URLs", () => {
    expect(canvasUrlFrom("File not found: C:/a.pdf")).toBeUndefined()
    expect(canvasUrlFrom("See https://example.com:8080/#/x")).toBeUndefined()
    expect(canvasUrlFrom(undefined)).toBeUndefined()
  })

  test("only the preview plugin's tools open the canvas", () => {
    expect(isCanvasTool("preview_file")).toBe(true)
    expect(isCanvasTool("artifact_create")).toBe(true)
    expect(isCanvasTool("preview_file", { open: false })).toBe(false)
    expect(isCanvasTool("webfetch")).toBe(false)
  })

  test("Code Mode execute calls count when they call a canvas tool", () => {
    expect(isCanvasTool("execute", { code: 'return await tools.artifact_create({ name: "ERD" })' })).toBe(true)
    expect(isCanvasTool("execute", { code: "return await tools.read({ path: 'a' })" })).toBe(false)
    expect(isCanvasTool("execute", {})).toBe(false)
  })
})
