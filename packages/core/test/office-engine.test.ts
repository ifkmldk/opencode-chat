import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OfficeEngine } from "../src/office/engine"
import { OfficeKit } from "../src/office/kit"

describe("OfficeEngine", () => {
  test("classifies files by extension", () => {
    expect(OfficeEngine.kindOf("a/Plan.DOCX")).toBe("docx")
    expect(OfficeEngine.kindOf("deck.pptx")).toBe("pptx")
    expect(OfficeEngine.kindOf("book.xlsm")).toBe("xlsx")
    expect(OfficeEngine.kindOf("data.csv")).toBe("xlsx")
    expect(OfficeEngine.kindOf("report.pdf")).toBe("pdf")
    expect(OfficeEngine.kindOf("page.htm")).toBe("html")
    expect(OfficeEngine.kindOf("photo.jpeg")).toBe("image")
    expect(OfficeEngine.kindOf("archive.zip")).toBeUndefined()
  })

  test("render output folders are stable per file and differ between files", () => {
    const first = OfficeEngine.outputDirectory(path.resolve("x/deck.pptx"))
    expect(OfficeEngine.outputDirectory(path.resolve("x/deck.pptx"))).toBe(first)
    expect(OfficeEngine.outputDirectory(path.resolve("y/deck.pptx"))).not.toBe(first)
  })

  test("rejects missing files and unsupported types with a clear message", async () => {
    await expect(OfficeEngine.render({ file: path.resolve("does-not-exist.pptx") })).rejects.toThrow("File not found")
  })
})

describe("OfficeKit", () => {
  test("honours the directory override and offers import lines", () => {
    const previous = process.env.OPENCODE_OFFICE_KIT
    process.env.OPENCODE_OFFICE_KIT = path.resolve("kit-dir")
    try {
      expect(OfficeKit.directory()).toBe(path.resolve("kit-dir"))
      expect(OfficeKit.importHint()).toContain("deck.mjs")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_OFFICE_KIT
      else process.env.OPENCODE_OFFICE_KIT = previous
    }
  })
})
