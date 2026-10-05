import { describe, expect, test } from "bun:test"
import { renderPages } from "./render-output"

describe("renderPages", () => {
  test("reads the engine, page count and page files", () => {
    expect(
      renderPages({ pdf: "a.pdf", engine: "powerpoint", pages: 7, files: [{ page: 1, file: "a-01.png" }, { page: 2, file: "a-02.png" }] }),
    ).toEqual({ engine: "powerpoint", pages: 7, files: [{ page: 1, file: "a-01.png" }, { page: 2, file: "a-02.png" }] })
  })

  test("tolerates a partial or invalid payload while the tool is running", () => {
    expect(renderPages(undefined)).toEqual({ files: [] })
    expect(renderPages("not an object")).toEqual({ files: [] })
    expect(renderPages({ files: [{ page: "1" }, null, { page: 3, file: "x.png" }] })).toEqual({
      engine: undefined,
      pages: undefined,
      files: [{ page: 3, file: "x.png" }],
    })
  })
})
