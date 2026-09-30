import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live(
  "browsing parents and siblings reuses the current Location and its MCP process",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const current = path.join(tmp.path, "root", "current")
      const starts = path.join(tmp.path, "starts")
      yield* Effect.promise(async () => {
        await fs.mkdir(current, { recursive: true })
        await fs.mkdir(path.join(tmp.path, "root", ".git"))
        await fs.mkdir(path.join(tmp.path, "root", "sibling", "nested"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "root", "sibling", "file.txt"), "outside")
        await fs.writeFile(starts, "")
        await fs.writeFile(
          path.join(tmp.path, "root", "opencode.json"),
          JSON.stringify({
            mcp: {
              servers: {
                filesystem: {
                  type: "local",
                  command: [process.execPath, path.join(import.meta.dir, "fixture", "mcp-starts.cjs"), starts],
                },
              },
            },
          }),
        )
      })
      const server = yield* startServer(path.join(tmp.path, "config"))
      const list = (directory: string) =>
        Effect.promise(async () => {
          const url = new URL("/api/fs/list", server.base)
          url.searchParams.set("location[directory]", current)
          url.searchParams.set("path", directory)
          const response = await fetch(url, { headers: server.headers })
          expect(response.status).toBe(200)
          const result = await response.json()
          expect(result.location.directory).toBe(current)
          return result.data
        })
      const loaded = Effect.promise(async () => {
        const response = await fetch(new URL("/api/debug/location", server.base), { headers: server.headers })
        expect(response.status).toBe(200)
        return response.json()
      })
      const count = Effect.promise(
        async () => (await fs.readFile(starts, "utf8")).trim().split("\n").filter(Boolean).length,
      )

      yield* list(".")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(
        yield* count.pipe(
          Effect.repeat({ while: (n) => n === 0, schedule: Schedule.spaced("25 millis") }),
          Effect.timeout("5 seconds"),
        ),
      ).toBe(1)

      yield* list("..")
      const sibling = yield* list("../sibling")
      expect(sibling).toEqual([
        { path: path.join("..", "sibling", "nested") + path.sep, type: "directory" },
        { path: path.join("..", "sibling", "file.txt"), type: "file" },
      ])
      expect(yield* list(path.join(tmp.path, "root", "sibling"))).toEqual(sibling)
      yield* list("../sibling/nested")
      yield* list("../sibling")
      expect(yield* loaded).toEqual([{ directory: current }])
      expect(yield* count).toBe(1)
    }),
  15_000,
)

// fork: the app sends the path base64url-encoded so the URL never names the file, and script reads get plain
// bytes; download managers (IDM) otherwise take over the request. Percent-encoded paths still work.
it.live("reads a file by encoded name and serves script reads as plain bytes", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "report.pdf"), "%PDF-1.4"))
    const server = yield* startServer(path.join(tmp.path, "config"))
    const read = (headers: Record<string, string>, path = `~b64~${Buffer.from("report.pdf").toString("base64url")}`) =>
      Effect.promise(async () => {
        const url = new URL(`/api/fs/read/${path}`, server.base)
        url.searchParams.set("location[directory]", tmp.path)
        const response = await fetch(url, { headers: { ...server.headers, ...headers } })
        return { type: response.headers.get("content-type"), body: await response.text() }
      })
    const script = yield* read({ "sec-fetch-dest": "empty" })
    expect(script).toEqual({ type: "application/octet-stream", body: "%PDF-1.4" })
    const frame = yield* read({ "sec-fetch-dest": "iframe" })
    expect(frame.type).toContain("application/pdf")
    expect((yield* read({ "sec-fetch-dest": "empty" }, "report%2Epdf")).body).toBe("%PDF-1.4")
  }),
)
