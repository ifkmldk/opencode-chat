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
