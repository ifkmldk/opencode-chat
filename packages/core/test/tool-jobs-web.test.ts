import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { JobWeb } from "../src/tool/plugin/job-web"

const ok = (urls: string[]) => Effect.succeed({ providerID: "p", results: urls.map((url) => ({ url, title: url })) } as never)

describe("JobWeb.search", () => {
  test("does not double the word lowongan", () => {
    expect(JobWeb.queries("lowongan data analyst Bandung")[0]).toBe("lowongan data analyst Bandung")
    expect(JobWeb.queries("data analyst Bandung")[0]).toBe("lowongan data analyst Bandung")
  })

  test("falls through to a broader phrasing when the first returns nothing", async () => {
    const seen: string[] = []
    const out = await Effect.runPromise(JobWeb.search((q) => (seen.push(q), seen.length === 1 ? ok([]) : ok(["https://x.test/job"])), "data analyst Bandung"))
    expect(out.results).toHaveLength(1)
    expect(seen).toHaveLength(2)
  })

  test("returns the provider error when every phrasing fails", async () => {
    const out = await Effect.runPromise(JobWeb.search(() => Effect.fail(new Error("provider down")) as never, "data analyst"))
    expect(out.results).toHaveLength(0)
    expect(out.error).toBe("provider down")
  })
})
