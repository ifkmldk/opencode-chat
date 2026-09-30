import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { turnArtifacts } from "./assistant-artifact-model"

const directory = "C:/Users/me/project"

function assistant(...content: SessionMessageAssistant["content"]): SessionMessageAssistant {
  return {
    id: `msg_${content.length}`,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1, completed: 2 },
    content,
  }
}

function text(value: string): SessionMessageAssistant["content"][number] {
  return { type: "text", text: value }
}

function tool(
  name: string,
  input: Record<string, JsonValue>,
  output: string,
  metadata?: Record<string, JsonValue>,
  status: "completed" | "error" = "completed",
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: `tool_${name}_${output.length}`,
    name,
    state:
      status === "completed"
        ? { status, input, content: [{ type: "text", text: output }], metadata }
        : { status, input, error: { type: "unknown", message: output } },
    time: { created: 1, completed: 2 },
  }
}

const paths = (messages: SessionMessageAssistant[]) => turnArtifacts(messages, directory).map((item) => item.path)

describe("turn artifacts", () => {
  test("reads Windows, file: and angle-bracket link targets", () => {
    const items = turnArtifacts(
      [
        assistant(
          text(String.raw`[report](C:\Users\me\AppData\Local\Temp\opencode\report.pdf)`),
          text("[deck](file:///C:/Users/me/My%20Deck.pptx) and [notes](<C:/My Files/notes.docx>)"),
          text(String.raw`[escaped](C:\tmp\_out\a.xlsx)`),
        ),
      ],
      directory,
    )
    expect(items).toEqual([
      { path: "C:/Users/me/AppData/Local/Temp/opencode/report.pdf", name: "report.pdf", kind: "document" },
      { path: "C:/Users/me/My Deck.pptx", name: "My Deck.pptx", kind: "presentation" },
      { path: "C:/My Files/notes.docx", name: "notes.docx", kind: "document" },
      { path: "C:/tmp/_out/a.xlsx", name: "a.xlsx", kind: "spreadsheet" },
    ])
  })

  test("explicit links card any file, but code references do not", () => {
    expect(
      paths([assistant(text("See [the plan](docs/plan.md), [main](src/main.ts), [line](src/app.ts:42) and [anchor](src/x.ts#L3)."))]),
    ).toEqual(["docs/plan.md", "src/main.ts"])
  })

  test("ignores web links, fragments, other schemes, directories and data URIs", () => {
    expect(
      paths([
        assistant(
          text("[site](https://example.com/a.pdf) [anchor](#report) [mail](mailto:a@example.com) [dir](outputs/)"),
          text("![inline](data:image/png;base64,AAAA) https://example.com/files/report.pdf"),
        ),
      ]),
    ).toEqual([])
  })

  test("write and patch results only card output-like files", () => {
    expect(
      paths([
        assistant(
          tool("write", { path: "out\\data.csv" }, "Created file successfully: out/data.csv"),
          tool("write", { path: "src/app.ts" }, "Created file successfully: src/app.ts"),
          tool("write", { path: "C:\\Users\\me\\AppData\\Local\\Temp\\opencode\\chart.png" }, "no result text"),
          tool("patch", { patchText: "" }, "Success.", {
            files: [
              { file: "site/index.html", status: "added" },
              { file: "src/lib.ts", status: "added" },
              { file: "report/old.pdf", status: "modified" },
            ],
          }),
        ),
      ]),
    ).toEqual(["out/data.csv", "C:/Users/me/AppData/Local/Temp/opencode/chart.png", "site/index.html", "report/old.pdf"])
  })

  test("a later patch deletion removes an earlier card", () => {
    expect(
      paths([
        assistant(tool("write", { path: "out/draft.pdf" }, "Created file successfully: out/draft.pdf")),
        assistant(
          tool("patch", { patchText: "" }, "Success.", { files: [{ file: "out/draft.pdf", status: "deleted" }] }),
        ),
      ]),
    ).toEqual([])
  })

  test("inline code and bare paths count for output files only", () => {
    expect(
      paths([
        assistant(
          text(
            [
              String.raw`Saved to C:\Users\me\Music\song.mp3.`,
              String.raw`The slides are in ${"`"}C:\Users\me\My Deck v2.pptx${"`"}, the table in output/summary.xlsx.`,
              "Check `src/main.ts`, `AGENTS.md`, `df.to_csv(\"x.csv\")` and /c/Users/me/clip.mp4 too.",
              "```",
              String.raw`C:\in\fence.pdf`,
              "```",
            ].join("\n"),
          ),
        ),
      ]),
    ).toEqual(["C:/Users/me/My Deck v2.pptx", "C:/Users/me/Music/song.mp3", "output/summary.xlsx", "C:/Users/me/clip.mp4"])
  })

  test("deduplicates across messages, spellings and drive-letter case", () => {
    expect(
      paths([
        assistant(tool("write", { path: "out/r.pdf" }, "Created file successfully: out/r.pdf")),
        assistant(text(String.raw`Done: [r.pdf](c:/users/me/project/out/r.pdf) and ${"`"}.\out\r.pdf${"`"}`)),
      ]),
    ).toEqual(["out/r.pdf"])
  })

  test("ignores streaming, running and failed tools, and uses tool file items with local URIs", () => {
    const streaming: SessionMessageAssistantTool = {
      type: "tool",
      id: "tool_streaming",
      name: "write",
      state: { status: "streaming", input: "{\"path\":\"out/a.pdf\"" },
      time: { created: 1 },
    }
    const image: SessionMessageAssistantTool = {
      type: "tool",
      id: "tool_image",
      name: "screenshot",
      state: {
        status: "completed",
        input: {},
        content: [
          { type: "file", uri: "file:///C:/Users/me/shot.png", mime: "image/png" },
          { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" },
        ],
      },
      time: { created: 1, completed: 2 },
    }
    expect(
      paths([
        assistant(
          streaming,
          tool("write", { path: "out/b.pdf" }, "failed", undefined, "error"),
          image,
        ),
      ]),
    ).toEqual(["C:/Users/me/shot.png"])
  })
})
