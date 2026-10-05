import { describe, expect, test } from "bun:test"
import { ScrapeExtract } from "../src/scrape/extract"
import { UltimateScrape } from "../src/scrape/engine"

describe("ScrapeExtract", () => {
  test("keeps the main block and drops menus and footers", () => {
    const html = `<html><body><nav>Home Jobs About</nav><main><h1>Data Analyst</h1><p>${"Analyse data and build dashboards for the business. ".repeat(10)}</p></main><footer>Copyright</footer></body></html>`
    const main = ScrapeExtract.mainContent(html)
    expect(main).toContain("Data Analyst")
    expect(main).not.toContain("Home Jobs About")
    expect(main).not.toContain("Copyright")
  })

  test("without a main block it strips page chrome but keeps the body text", () => {
    const html = `<body><header>Logo</header><div><p>${"Open roles in Bandung for analysts. ".repeat(12)}</p></div><footer>Legal</footer></body>`
    const main = ScrapeExtract.mainContent(html)
    expect(main).toContain("Open roles in Bandung")
    expect(main).not.toContain("Legal")
  })

  test("never returns an empty page when stripping removes everything", () => {
    const html = `<body><nav>Only a menu here</nav></body>`
    expect(ScrapeExtract.mainContent(html)).toContain("Only a menu here")
  })

  test("reads JobPosting JSON-LD, including @graph and bad blocks", () => {
    const html = `<script type="application/ld+json">{nope</script>
<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"BI Analyst","hiringOrganization":{"name":"PT Maju"},"jobLocation":{"address":{"addressLocality":"Tangerang","addressRegion":"Banten"}},"datePosted":"2026-10-01","validThrough":"2026-11-01","baseSalary":{"currency":"IDR","value":{"minValue":11000000,"maxValue":15000000,"unitText":"MONTH"}},"url":"https://x.test/job/1"}]}</script>`
    const jobs = ScrapeExtract.jobPostings(html)
    expect(jobs).toEqual([
      { title: "BI Analyst", company: "PT Maju", location: "Tangerang, Banten", posted: "2026-10-01", expires: "2026-11-01", salary: "IDR 11000000 - 15000000 / MONTH", url: "https://x.test/job/1" },
    ])
    expect(ScrapeExtract.jobPostingsMarkdown(jobs)).toContain("**BI Analyst** · PT Maju · Tangerang, Banten")
  })

  test("recognises empty shells, menu stubs and bot walls as not useful", () => {
    expect(ScrapeExtract.isUseful("")).toBe(false)
    expect(ScrapeExtract.isUseful("Menu Home Jobs")).toBe(false)
    expect(ScrapeExtract.isUseful(`Just a moment... ${"x".repeat(300)}`)).toBe(false)
    expect(ScrapeExtract.isUseful("# Your connection is not private " + "y".repeat(300))).toBe(false)
    expect(ScrapeExtract.isUseful("Real content about open positions. ".repeat(20))).toBe(true)
  })
})

describe("UltimateScrape plan", () => {
  test("auto escalates from a plain GET to a rendering browser; stealth leads with it", () => {
    expect(UltimateScrape.planFor({})).toEqual(["webfetch", "chromium", "scrapegraph"])
    expect(UltimateScrape.planFor({ mode: "fast" })).toEqual(["webfetch"])
    expect(UltimateScrape.planFor({ mode: "stealth" })[0]).toBe("chromium")
  })

  test("bridge scripts are written from the embedded copies and read stdin", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"))
    process.env.OPENCODE_SCRAPER_DIR = dir
    try {
      const file = UltimateScrape.__test.bridgeFile("scrapling.py")
      expect(file.startsWith(dir)).toBe(true)
      expect(fs.readFileSync(file, "utf8")).toContain("sys.stdin.read()")
    } finally {
      delete process.env.OPENCODE_SCRAPER_DIR
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
