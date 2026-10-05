import { describe, expect, test } from "bun:test"
import { JobBoards } from "../src/scrape/jobboards"

const card = (id: string, title: string, company: string, where: string, salary = "") =>
  `<article data-automation="normalJob"><a href="/id/job/${id}?type=standard" id="job-title-${id}" data-automation="jobTitle">${title}</a>
   <a data-type="company" data-automation="jobCompany">${company}</a><a data-type="location" data-automation="jobLocation">${where}</a>
   ${salary ? `<div aria-label="Salary: ${salary}"></div>` : ""}<span data-automation="jobListingDate">2 hari yang lalu</span></article>`

describe("JobBoards", () => {
  test("reads cards into listings with a clean listing link", () => {
    const rows = JobBoards.jobstreet(card("95046378", "Senior Data Analyst", "PT Maju", "Bandung, Jawa Barat", "Rp 7.000.000 per month"))
    expect(rows[0]).toMatchObject({ id: "95046378", title: "Senior Data Analyst", company: "PT Maju", location: "Bandung, Jawa Barat", url: "https://id.jobstreet.com/id/job/95046378" })
    expect(rows[0]?.salary).toContain("7.000.000")
  })

  test("the city printed on the card decides; a bare province or another city is not a match", () => {
    expect(JobBoards.inCities({ location: "Bandung, Jawa Barat" }, ["bandung"])).toBe(true)
    expect(JobBoards.inCities({ location: "Kabupaten Bandung, Jawa Barat" }, ["bandung"])).toBe(true)
    expect(JobBoards.inCities({ location: "Jawa Barat" }, ["bandung", "cimahi"])).toBe(false)
    expect(JobBoards.inCities({ location: "Purwakarta, Jawa Barat" }, ["bandung", "cimahi"])).toBe(false)
  })

  test("splits the question into role and cities", () => {
    const places = JobBoards.cities("lowongan data analyst Bandung Cimahi", "Bandung, Indonesia")
    expect(places).toEqual(["bandung", "cimahi"])
    expect(JobBoards.role("lowongan data analyst Bandung Cimahi", places)).toBe("data analyst")
  })
})

test("filler like site/career/company never leaks into the job title", () => {
  const places = JobBoards.cities("Data Analyst Bandung site company career", "Bandung, Indonesia")
  expect(JobBoards.role("Data Analyst Bandung site company career", places)).toBe("data analyst")
})

test("reads LinkedIn public cards", () => {
  const html = `<li> <div class="base-card x" data-entity-urn="urn:li:jobPosting:4465634372"><a href="https://id.linkedin.com/jobs/view/x-4465634372?p=1"></a><h3 class="base-search-card__title"> Data Analyst </h3><h4 class="base-search-card__subtitle"><a> Agoda </a></h4><span class="job-search-card__location"> Bandung, West Java, Indonesia </span><time datetime="2026-10-01">1 minggu lalu</time></div></li>`
  expect(JobBoards.linkedin(html)[0]).toMatchObject({ id: "4465634372", title: "Data Analyst", company: "Agoda", location: "Bandung, West Java, Indonesia", url: "https://www.linkedin.com/jobs/view/4465634372" })
})

test("official host check and cross-board dedupe", () => {
  expect(JobBoards.isOfficialHost("https://career.eigerindo.co.id/jobs")).toBe(true)
  expect(JobBoards.isOfficialHost("https://id.jobstreet.com/id/job/1")).toBe(false)
  expect(JobBoards.isOfficialHost("https://www.linkedin.com/jobs/view/1")).toBe(false)
  const a = { id: "1", title: "Data Analyst", company: "PT Maju", url: "u1", board: "jobstreet" }
  expect(JobBoards.dedupe([a, { ...a, id: "2", url: "u2", board: "linkedin" }])).toHaveLength(1)
})

test("Indonesian spelling counts as the same job word", () => {
  expect(JobBoards.titleHas("Staff Data Analis", "analyst")).toBe(true)
  expect(JobBoards.titleHas("Sales Trainee", "analyst")).toBe(false)
})
