import { describe, expect, test } from "bun:test"
import { researchExportBlock, validateResearchProviderUrl } from "./research-provider-fields"

describe("research provider fields", () => {
  test("validates endpoint URLs without accepting credentials", () => {
    expect(validateResearchProviderUrl("")).toBeUndefined()
    expect(validateResearchProviderUrl("https://jobs.example.com/search")).toBeUndefined()
    expect(validateResearchProviderUrl("notaurl")).toBe("settings.general.row.researchProviders.invalidUrl")
    expect(validateResearchProviderUrl("ftp://example.com")).toBe("settings.general.row.researchProviders.invalidScheme")
    expect(validateResearchProviderUrl("https://user:pass@example.com")).toBe(
      "settings.general.row.researchProviders.noCredentials",
    )
  })

  test("builds copy-paste export commands without echoing secrets elsewhere", () => {
    const block = researchExportBlock({ OPENCODE_JOBS_API_URL: "https://jobs.example.com", OPENCODE_ACTION_WEBHOOK: "" })
    expect(block).toContain('export OPENCODE_JOBS_API_URL="https://jobs.example.com"')
    expect(block).toContain("# OPENCODE_ACTION_WEBHOOK is not set")
  })
})
