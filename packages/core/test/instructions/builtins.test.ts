import { describe, expect } from "bun:test"
import os from "os"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))
const timestamp = Date.parse("2026-06-03T12:00:00.000Z")
const temporary = os.tmpdir()
const temporaryLinkRoot = temporary.replaceAll("\\", "/")
const localDate = (time: number) => new Date(time).toDateString()
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(
    location(
      { directory },
      { projectDirectory, vcs: { type: "git", store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) } },
    ),
  ),
)
const it = testEffect(
  AppNodeBuilder.build(InstructionBuiltIns.node, [
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: temporary, tmp: temporary })),
  ]),
)

describe("InstructionBuiltIns", () => {
  it.effect("loads location-scoped environment and host-local date instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())
      // fork: the maps guidance (core/geo), the short response contract (core/response-contract) and the
      // office and todo guidance follow the output-files instruction.
      const blocks = initialized.text.split("\n\n")
      const geo = blocks.find((block) => block.startsWith("For real places"))
      expect(geo).toContain("[Name](place:<id>)")
      expect(geo).toContain("map_show")
      expect(geo).toContain("WGS84")
      const contract = blocks.find((block) => block.startsWith("# Response contract (fork)"))
      expect(contract).toContain("Summary")
      expect(contract).toContain("Verify")
      const office = blocks.find((block) => block.startsWith("When asked to create or edit a Word"))
      expect(office).toContain("office_render")
      const todo = blocks.find((block) => block.startsWith("For work with three or more steps"))
      expect(todo).toContain("todo_write")
      const plan = blocks.find((block) => block.startsWith("For a request to find, compare or recommend"))
      expect(plan).toContain("hard constraints")

      expect(blocks.filter((block) => ![geo, contract, office, todo, plan].includes(block)).join("\n\n")).toBe(
        [
          `Today's date: ${localDate(timestamp)}`,
          "",
          "Here is some useful information about the environment you are running in:",
          "<env>",
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${projectDirectory}`,
          "  Is directory a git repo: yes",
          `  Platform: ${process.platform}`,
          `  Prefer ${temporary} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
          "</env>",
          "",
          [
            "When you create or export files the user asked for (documents, spreadsheets, slides, images, audio, video, web pages, archives, or a requested script),",
            `end your reply with a Markdown link to each file using its absolute path with forward slashes, for example [report.pdf](${temporaryLinkRoot}/report.pdf).`,
            `Wrap a path that contains spaces in angle brackets, for example [My report.pdf](<${temporaryLinkRoot}/My report.pdf>).`,
            "Do not link source files you only edited while working.",
          ].join(" "),
        ].join("\n"),
      )
    }),
  )

  it.effect("updates the date without repeating unchanged environment instructions", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 24 * 60 * 60 * 1000)
      const refreshed = yield* readUpdate(yield* context.load(), initialized)

      expect(refreshed.text).toBe(`Today's date is now: ${localDate(timestamp + 24 * 60 * 60 * 1000)}`)
    }),
  )

  it.effect("does not update again within the same local calendar day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(timestamp)
      const context = yield* InstructionBuiltIns.Service
      const initialized = yield* readInitial(yield* context.load())

      yield* TestClock.setTime(timestamp + 60 * 60 * 1000)
      expect((yield* readUpdate(yield* context.load(), initialized)).changed).toBe(false)
    }),
  )
})
