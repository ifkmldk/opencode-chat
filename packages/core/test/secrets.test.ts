import { describe, expect, test } from "bun:test"
import { Secrets } from "../src/secrets"

describe("Secrets.scrub", () => {
  const env = {
    PATH: "C:/bin",
    HOME: "C:/Users/x",
    OPENCODE_9ROUTER_API_KEY: "sk-test-sentinel",
    OPENCODE_SERVER_PASSWORD: "pw",
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_AUTH_TOKEN: "t",
    GITHUB_TOKEN: "ghp_x",
    AWS_SECRET_ACCESS_KEY: "aws",
    DATABASE_PASSWORD: "db",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    OPENCODE_TERMINAL: "1",
    OPENCODE_SCRAPER_DIR: "C:/scrape",
    TERM: "xterm",
    MONKEY_BUSINESS: "keep",
  }

  test("removes provider keys, tokens and passwords", () => {
    const out = Secrets.scrub(env)
    for (const name of ["OPENCODE_9ROUTER_API_KEY", "OPENCODE_SERVER_PASSWORD", "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "DATABASE_PASSWORD"])
      expect(out[name]).toBeUndefined()
  })

  test("keeps ordinary variables, including OPENCODE_* settings", () => {
    const out = Secrets.scrub(env)
    expect(out.PATH).toBe("C:/bin")
    expect(out.NPM_CONFIG_REGISTRY).toBeDefined()
    expect(out.OPENCODE_TERMINAL).toBe("1")
    expect(out.OPENCODE_SCRAPER_DIR).toBe("C:/scrape")
    expect(out.MONKEY_BUSINESS).toBe("keep")
  })

  test("a passthrough list lets chosen names through", () => {
    const out = Secrets.scrub({ ...env, OPENCODE_CHILD_ENV_PASSTHROUGH: "github_token, NPM_TOKEN" })
    expect(out.GITHUB_TOKEN).toBe("ghp_x")
    expect(out.OPENAI_API_KEY).toBeUndefined()
  })
})
