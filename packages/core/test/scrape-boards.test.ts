import { expect, test } from "bun:test"
import { Boards } from "../src/scrape/boards"
import { JobBoards } from "../src/scrape/jobboards"

test("Glints: jobs from the Apollo cache, with the area chain as location", () => {
  const cache = {
    "Job:1": { __typename: "Job", id: "1", title: "Data Analyst", company: { __ref: "Company:c" }, location: { __ref: "HierarchicalLocation:l" }, updatedAt: "2026-09-18T08:25:12Z" },
    "Company:c": { name: "Keyventure" },
    "HierarchicalLocation:l": { formattedName: "Kiaracondong", parents: [{ __ref: "LocationParent:b" }, { __ref: "LocationParent:j" }] },
    "LocationParent:b": { formattedName: "Bandung" },
    "LocationParent:j": { formattedName: "Jawa Barat" },
  }
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { apolloCache: cache } })}</script>`
  expect(Boards.glints(html)[0]).toMatchObject({ title: "Data Analyst", company: "Keyventure", location: "Kiaracondong, Bandung, Jawa Barat", url: "https://glints.com/id/opportunities/jobs/data-analyst/1" })
})

test("Indeed: cards from the mosaic provider JSON", () => {
  const data = { metaData: { mosaicProviderJobCardsModel: { results: [{ jobkey: "8c71", title: "Business Analyst", company: "Xtremax", formattedLocation: "Bandung" }] } } }
  const html = `<script>window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(data)};</script>`
  expect(Boards.indeed(html)[0]).toMatchObject({ title: "Business Analyst", location: "Bandung", url: "https://id.indeed.com/viewjob?jk=8c71" })
})

test("KitaLulus: open vacancies from the page's server data", () => {
  const list = { list: [{ id: "a", slug: "da-bdg", positionName: "Data Analyst", isClosed: false, company: { name: "PT X" }, city: { name: "Kota Bandung" }, province: { name: "Jawa Barat" }, salaryLowerBound: 5000000, salaryUpperBound: 7000000 }, { id: "b", slug: "old", positionName: "Old", isClosed: true }] }
  const html = `<script>self.__next_f.push([1,"{\\"vacancyList\\":${JSON.stringify(list).replace(/"/g, '\\"')}}"])</script>`
  const rows = Boards.kitalulus(html)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ title: "Data Analyst", location: "Kota Bandung, Jawa Barat", url: "https://www.kitalulus.com/lowongan/detail/da-bdg" })
  expect(rows[0]?.salary).toContain("5.000.000")
})

test("a title that says the job is based in another city is not counted for this one", () => {
  expect(JobBoards.basedElsewhere("Senior Analyst, PPC (Bangkok Based, Relocation Provided)", ["bandung"])).toBe(true)
  expect(JobBoards.basedElsewhere("Data Analyst (Bandung based)", ["bandung"])).toBe(false)
  expect(JobBoards.basedElsewhere("Data Analyst", ["bandung"])).toBe(false)
})

test("Glassdoor is never scraped: the user gets the search link", () => {
  expect(Boards.manualSearch({ role: "data analyst", cities: ["bandung"] })[0]?.url).toContain("glassdoor.com")
})

test("Loker.id: jobs from its data route, with the site's own detail address", () => {
  const rows = Boards.lokerid({
    jobs: [{ id: 1, slug: "data-analyst-taiyo-bandung-barat", title: "Data Analyst", company_name: "Taiyo", categories: [{ slug: "data-analis", parent: { slug: "research-development" } }], locations: [{ name: "Bandung Barat", parent: { name: "Jawa Barat" } }], salary: { name: "Rp.4 – 5 Juta" }, display_date: "2026-09-28 07:11:23" }],
  })
  expect(rows[0]).toMatchObject({ title: "Data Analyst", location: "Bandung Barat, Jawa Barat", salary: "Rp.4 – 5 Juta", posted: "2026-09-28", url: "https://www.loker.id/research-development/data-analis/data-analyst-taiyo-bandung-barat.html" })
})

test("Karir.com: cards read from the page, linked to the search because a card has no address of its own", () => {
  const html = `<div class="info-company-stack"><p class="x" type="Heading4">SQL Analyst</p><p class="y">PT Daya Medika</p><p>Rp&nbsp;6 juta - Rp&nbsp;8 juta/bulan</p><p>Bandung</p><p>22 September 2026</p></div>`
  expect(Boards.karir(html, "https://karir.com/search-lowongan?keyword=sql")[0]).toMatchObject({ title: "SQL Analyst", company: "PT Daya Medika", location: "Bandung", posted: "22 September 2026", url: "https://karir.com/search-lowongan?keyword=sql" })
})

test("unreadable boards are listed with their reason, never guessed", () => {
  const boards = Boards.manualSearch({ role: "data analyst", cities: ["bandung"] }).map((item) => item.board)
  expect(boards).toEqual(["glassdoor", "jobs.id", "topkarir"])
})

test("Kalibrr: the office street from google_location and the salary period (live response shape, 2026-10-06)", () => {
  const rows = Boards.kalibrr({
    jobs: [
      { id: 1, name: "Data Analyst", slug: "data-analyst", company: { name: "Astro Technologies Indonesia", code: "astro" }, google_location: { address_components: { address_line_1: "27, Jalan Tomang Raya, Tomang Kel., Grogol Petamburan", city: "West Jakarta", country: "Indonesia", region: "DKI Jakarta" } }, salary_shown: true, base_salary: 9000000, maximum_salary: 12000000, salary_interval: "month", activation_date: "2026-10-01T00:00:00" },
      { id: 2, name: "Data Engineer", company: { name: "PT Metrodata Electronics, Tbk", code: "metrodata" }, google_location: { address_components: { city: "Central Jakarta", region: "DKI Jakarta" } }, salary_shown: false, maximum_salary: 10000000 },
    ],
  })
  expect(rows[0]).toMatchObject({ location: "West Jakarta, DKI Jakarta", address: "Jalan Tomang Raya 27, Tomang, Grogol Petamburan, Jakarta Barat, DKI Jakarta", salary: "Rp 9.000.000 – 12.000.000 per month" })
  expect(rows[1]?.address).toBeUndefined()
  expect(rows[1]?.salary).toBeUndefined()
})

test("Kalibrr addresses are rewritten the way geocoders read them", () => {
  expect(Boards.kalibrrAddress("RT09/RW05, Podomoro City, Tanjung Duren Selatan Kel., Grogol Petamburan", "West Jakarta", "DKI Jakarta")).toBe("Podomoro City, Tanjung Duren Selatan, Grogol Petamburan, Jakarta Barat, DKI Jakarta")
  expect(Boards.kalibrrAddress("Jl. Palmerah Selatan No. 22-28. Jakarta, Indonesia", "Purwakarta Regency", "West Java (Jawa Barat)")).toBe("Jl. Palmerah Selatan No. 22-28. Jakarta, Indonesia")
})
