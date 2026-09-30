import { describe, expect, test } from "bun:test"
import { launcherToken } from "./auth-token"

function memory() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

describe("launcherToken", () => {
  test("keeps the launcher token for later loads of the same window", () => {
    const storage = memory()
    expect(launcherToken("?auth_token=b3BlbmNvZGU6cWEtdXhkaWZm&x=1", storage)).toBe("b3BlbmNvZGU6cWEtdXhkaWZm")
    expect(launcherToken("", storage)).toBe("b3BlbmNvZGU6cWEtdXhkaWZm")
  })

  test("a new token replaces the stored one", () => {
    const storage = memory()
    launcherToken("?auth_token=old", storage)
    expect(launcherToken("?auth_token=new", storage)).toBe("new")
    expect(launcherToken("?other=1", storage)).toBe("new")
  })

  test("without a token or stored value there is nothing to sign in with", () => {
    expect(launcherToken("", memory())).toBeNull()
  })

  test("blocked storage still uses the URL token", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(launcherToken("?auth_token=abc", blocked)).toBe("abc")
    expect(launcherToken("", blocked)).toBeNull()
  })
})
