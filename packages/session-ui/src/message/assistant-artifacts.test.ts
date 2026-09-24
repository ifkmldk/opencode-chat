import { describe, expect, test } from "bun:test"
import { assistantArtifacts } from "./assistant-artifact-model"

describe("assistant artifacts", () => {
  test("collects unique local file links and classifies their formats", () => {
    const artifacts = assistantArtifacts(
      "I created [the report](outputs/report.pdf), [the chart](outputs/chart.png), and [source](src/main.ts). [again](outputs/report.pdf)",
    )
    expect(artifacts).toEqual([
      { path: "outputs/report.pdf", label: "the report", kind: "document" },
      { path: "outputs/chart.png", label: "the chart", kind: "image" },
      { path: "src/main.ts", label: "source", kind: "file" },
    ])
  })

  test("ignores external links, fragments, directories, and non-file schemes", () => {
    expect(
      assistantArtifacts(
        "[site](https://example.com/a.pdf) [anchor](#report) [docs](https://example.com) [mail](mailto:a@example.com) [dir](outputs/)",
      ),
    ).toEqual([])
  })

  test("removes line suffixes while preserving the file path", () => {
    expect(assistantArtifacts("[source](src/main.ts:42:8)")).toEqual([
      { path: "src/main.ts", label: "source", kind: "file" },
    ])
  })
})
