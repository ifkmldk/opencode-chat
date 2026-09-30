import { describe, expect, test } from "bun:test"
import { createApiForServer } from "@/runtime/server/api"
import { artifactsExist, readArtifact } from "./artifact-download"

function setup(respond: (url: URL) => Response | Promise<Response>) {
  const requests: URL[] = []
  const api = createApiForServer({
    server: { url: "https://server.example:4096", password: "secret" },
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input)
      requests.push(url)
      return respond(url)
    }) as typeof fetch,
  })
  return { api, requests }
}

const listing = (...files: string[]) =>
  Response.json({
    location: { directory: "ignored" },
    data: files.map((path) => ({ path, type: path.endsWith("/") ? "directory" : "file" })),
  })

// The client sends the path base64url-encoded so the URL never names the file (download managers grab those).
describe("readArtifact", () => {
  test.each([
    ["C:/Users/me/AppData/Local/Temp/opencode/data.zip", "C:/Users/me/AppData/Local/Temp/opencode/", "data.zip", "application/octet-stream"],
    ["out/report.pdf", "C:/Users/me/project", "out/report.pdf", "application/pdf"],
    ["/tmp/opencode/unknown.bin", "/tmp/opencode/", "unknown.bin", "application/octet-stream"],
  ])("reads %s byte for byte from the right location", async (path, directory, encoded, type) => {
    const { api, requests } = setup(() => new Response(new Uint8Array([0, 127, 255])))
    const blob = await readArtifact(api, "C:/Users/me/project", path)

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 127, 255]))
    expect(blob.type).toBe(type)
    expect(requests).toHaveLength(1)
    expect(requests[0].pathname).toBe(`/api/fs/read/~b64~${Buffer.from(encoded).toString("base64url")}`)
    expect([...requests[0].searchParams]).toEqual([["location[directory]", directory]])
  })
})

describe("artifactsExist", () => {
  test("lists each parent folder once and keeps the paths that are present", async () => {
    const { api, requests } = setup((url) => {
      const folder = url.searchParams.get("location[directory]")
      if (folder === "C:/Users/me/project/out/") return listing("report.PDF", "data.csv", "nested/")
      if (folder === "C:/Temp/opencode/") return listing("chart.png")
      return new Response("missing", { status: 500 })
    })
    const found = await artifactsExist(api, "C:/Users/me/project/", [
      "out/report.pdf",
      "out/data.csv",
      "out/nested",
      "out/missing.xlsx",
      "C:/Temp/opencode/chart.png",
      "C:/Gone/deck.pptx",
    ])

    expect([...found].toSorted()).toEqual(["C:/Temp/opencode/chart.png", "out/data.csv", "out/report.pdf"])
    expect(requests.map((url) => url.searchParams.get("location[directory]")).toSorted()).toEqual([
      "C:/Gone/",
      "C:/Temp/opencode/",
      "C:/Users/me/project/out/",
    ])
  })
})
