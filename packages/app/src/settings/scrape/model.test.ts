import { describe, expect, test } from "bun:test"
import { DEFAULT_VAULT_DIR, MEMORY_KINDS, MEMORY_SCOPES, normalizeVaultDir } from "../memory/model.js"
import { SCRAPE_MODES, defaultScrapeStatus, scrapeModeFrom, scrapeStatusLabel } from "./model.js"

describe("settings models", () => {
  test("scraper lists the ultimate engines with fast ready", () => {
    const status = defaultScrapeStatus()
    expect(status.map((entry) => entry.engine)).toEqual(["webfetch", "scrapling", "camofox", "scrapegraph", "agent-reach"])
    expect(status.find((entry) => entry.engine === "webfetch")?.status).toBe("ready")
    expect(status.find((entry) => entry.engine === "scrapling")?.status).toBe("ready")
    expect(scrapeStatusLabel(status[0]!)).toContain("ready")
    expect(scrapeStatusLabel(status.find((entry) => entry.engine === "camofox")!)).toContain("ready")
  })

  test("scraper mode parsing falls back to auto", () => {
    expect([...SCRAPE_MODES]).toEqual(["auto", "fast", "stealth", "ai", "channels"])
    expect(scrapeModeFrom("stealth")).toBe("stealth")
    expect(scrapeModeFrom("laya")).toBe("auto")
    expect(scrapeModeFrom(undefined)).toBe("auto")
  })

  test("memory exposes the vault scopes and kinds", () => {
    expect([...MEMORY_SCOPES]).toEqual(["global", "project", "session"])
    expect([...MEMORY_KINDS]).toEqual(["fact", "preference", "decision", "correction", "person", "project-brief"])
    expect(DEFAULT_VAULT_DIR).toContain("Obsidian")
    expect(normalizeVaultDir("C:/vault")).toBe("C:/vault")
    expect(normalizeVaultDir(undefined)).toBe("")
  })
})
