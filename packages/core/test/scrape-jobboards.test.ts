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

describe("role phrases", () => {
  const owner =
    "Carikan perusahaan yang buka loker data analyst atau sejenisnya posisi yg relevan dengan gaji di atas 11 juta. lokasi perusahaannya wajib radius <1km dari KRL, boleh dari line rangkas bitung atau yg line lain. yg jelas dari stasiun KRL tsb bisa jalan kaki hemat ongkos."

  test("salary, station and filler words never become part of a role; similar roles are added when asked", () => {
    const phrases = JobBoards.phrases(owner)
    expect(phrases).toEqual(["data analyst", "business intelligence", "bi analyst", "reporting analyst"])
    for (const word of ["gaji", "atas", "juta", "11", "krl", "stasiun", "radius", "km", "lokasi", "jalan", "kaki", "line", "rangkas", "wajib", "hemat"])
      expect(phrases.join(" ").split(" ")).not.toContain(word)
  })

  test("a run of several roles is split into phrases; data scientist only when asked", () => {
    expect(JobBoards.phrases("data analyst BI reporting analyst gaji di atas 11 juta")).toEqual(["data analyst", "reporting analyst", "bi analyst"])
    expect(JobBoards.phrases("data analyst business intelligence reporting analyst")).toEqual(["data analyst", "business intelligence", "reporting analyst"])
    expect(JobBoards.phrases("data analyst atau sejenisnya")).not.toContain("data scientist")
    expect(JobBoards.phrases("data scientist atau data engineer, linkedin, ig, facebook, x post, job portal dll")).toEqual(["data scientist", "data engineer"])
  })

  test("a title fits when it has every word of one phrase as whole words; 'bi' is never inside Mobile", () => {
    const phrases = ["data analyst", "business intelligence", "bi analyst", "reporting analyst"]
    expect(JobBoards.matchLevel("Senior Data Analyst", phrases)).toBe("tepat")
    expect(JobBoards.matchLevel("Analis Data", phrases)).toBe("tepat")
    expect(JobBoards.matchLevel("Business Intelligence Specialist", phrases)).toBe("tepat")
    expect(JobBoards.matchLevel("Data Engineer", phrases)).toBe("mirip")
    expect(JobBoards.matchLevel("Mobile Developer", phrases)).toBeUndefined()
    expect(JobBoards.matchLevel("Cyber Security Analyst", phrases)).toBeUndefined()
    expect(JobBoards.matchLevel("Business Development", phrases)).toBeUndefined()
    expect(JobBoards.titleHas("Mobile Engineer", "bi")).toBe(false)
  })

  test("a career page matches any phrase with its words close together", () => {
    const phrases = ["data analyst", "bi analyst"]
    expect(JobBoards.phraseIn("Open roles: Analis Data (Jakarta), Finance Staff", phrases)).toBe("data analyst")
    expect(JobBoards.phraseIn("We build data platforms. Our marketing team has an analyst.", phrases)).toBeUndefined()
  })
})

describe("cities", () => {
  test("Tangerang Selatan is not Tangerang, and the reverse", () => {
    expect(JobBoards.cities("loker data analyst tangerang selatan")).toEqual(["tangerang selatan"])
    expect(JobBoards.inCities({ location: "Tangerang, Banten" }, ["tangerang selatan"])).toBe(false)
    expect(JobBoards.inCities({ location: "Tangerang Selatan, Banten" }, ["tangerang"])).toBe(false)
    expect(JobBoards.inCities({ location: "Serpong, Tangerang Selatan" }, ["tangerang selatan"])).toBe(true)
  })

  test("English and district forms count for their city", () => {
    expect(JobBoards.inCities({ location: "South Jakarta, DKI Jakarta" }, ["jakarta"])).toBe(true)
    expect(JobBoards.inCities({ location: "Setiabudi, Jakarta Selatan, DKI Jakarta" }, ["jakarta selatan"])).toBe(true)
    expect(JobBoards.inCities({ location: "Kemayoran, Jakarta Pusat, DKI Jakarta" }, ["jakarta selatan"])).toBe(false)
    expect(JobBoards.inCities({ location: "Cisauk, Kab. Tangerang" }, ["kabupaten tangerang"])).toBe(true)
    expect(JobBoards.inCities({ location: "Jakarta Metropolitan Area" }, ["jakarta"])).toBe(true)
  })

  test("KRL lines bring every city they run through; boards are searched under names they know", () => {
    const all = JobBoards.lineCities(["bogor", "cikarang", "rangkasbitung", "tangerang", "tanjung-priok"])
    for (const city of ["jakarta", "jakarta selatan", "tangerang", "tangerang selatan", "kabupaten tangerang", "bogor", "depok", "bekasi", "lebak"])
      expect(all).toContain(city)
    expect(JobBoards.searchCities(all)).toEqual(["jakarta", "tangerang selatan", "tangerang", "bekasi", "depok", "bogor", "cikarang", "rangkasbitung"])
  })
})

describe("dedupe and official sites", () => {
  test("keeps the first value of a duplicate and two cities stay two rows", () => {
    const first = { id: "1", title: "Data Analyst", company: "PT Maju", location: "Jakarta Selatan", salary: "Rp 12 juta", url: "u1", board: "kalibrr" }
    const rows = JobBoards.dedupe([first, { ...first, salary: "later" }, { ...first, id: "3", url: "u3", location: "Bandung" }])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.salary).toBe("Rp 12 juta")
  })

  test("aggregators, campus repositories and news sites are never an employer's site", () => {
    expect(JobBoards.isOfficialHost("https://eprints.upj.ac.id/id/eprint/1")).toBe(false)
    expect(JobBoards.isOfficialHost("https://suratplus.com/lowongan")).toBe(false)
    expect(JobBoards.isOfficialHost("https://lokerjakarta.id/data-analyst")).toBe(false)
    expect(JobBoards.isOfficialHost("https://karir.com/opportunities")).toBe(false)
    expect(JobBoards.isOfficialHost("https://karir.bca.co.id/")).toBe(true)
  })

  test("company tokens include the acronym of a generic name", () => {
    expect(JobBoards.companyTokens("PT Bank Central Asia Tbk")).toContain("bca")
    expect(JobBoards.companyTokens("MileApp")).toEqual(["mileapp"])
  })
})

describe("company website discovery", () => {
  test("only the company's own domain is a website: never boards, aggregators, social, repositories or site builders", () => {
    expect(JobBoards.acceptWebsite("https://www.cermati.com/karir", "PT Cermati Indonesia")).toBe(true)
    expect(JobBoards.acceptWebsite("https://karir.bca.co.id/", "PT Bank Central Asia Tbk")).toBe(true)
    expect(JobBoards.acceptWebsite("https://www.sigma-tech.co.id/", "SIGMATECH")).toBe(true)
    expect(JobBoards.acceptWebsite("https://www.linkedin.com/company/cermati", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://www.jobstreet.co.id/companies/cermati", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://lokercermati.id/", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://eprints.cermati.ac.id/1", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://cermati.business.site/", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://www.instagram.com/cermati/", "PT Cermati Indonesia")).toBe(false)
    // A host without the company name is someone else's site; a 3-letter token must be a whole label.
    expect(JobBoards.acceptWebsite("https://www.traveloka.com/", "PT Cermati Indonesia")).toBe(false)
    expect(JobBoards.acceptWebsite("https://abcarental.com/", "PT Bank Central Asia Tbk")).toBe(false)
    expect(JobBoards.acceptWebsite("ftp://cermati.com/", "PT Cermati Indonesia")).toBe(false)
  })
})

describe("company from a social or web post", () => {
  test("the employer named in post titles and text", () => {
    expect(JobBoards.companyFromPost("Dibutuhkan segera Data Analyst di PT Maju Jaya Sentosa untuk penempatan Jakarta")).toBe("PT Maju Jaya Sentosa")
    expect(JobBoards.companyFromPost("PT Sinar Data Nusantara is hiring! Data Analyst (Jakarta)")).toBe("PT Sinar Data Nusantara")
    expect(JobBoards.companyFromPost("Lowongan Kerja PT Astra Otoparts Tbk Data Analyst 2026")).toBe("PT Astra Otoparts Tbk")
    expect(JobBoards.companyFromPost("We're hiring at Traveloka - Data Analyst, Jakarta")).toBe("Traveloka")
    expect(JobBoards.companyFromPost("Gojek sedang mencari Business Intelligence Analyst")).toBe("Gojek")
    expect(JobBoards.companyFromPost("Loker PT Astra Otoparts Data Analyst Jakarta")).toBe("PT Astra Otoparts")
    expect(JobBoards.companyFromPost("Join us as Data Analyst! Kirim CV ke @tokopedia.careers")).toBe("Tokopedia")
  })

  test("aggregator accounts, cities and nameless posts give no company", () => {
    expect(JobBoards.companyFromPost("Lowongan Data Analyst Jakarta gaji 12 juta, kirim CV sekarang")).toBeUndefined()
    expect(JobBoards.companyFromPost("Info loker terbaru dari @lokerjakarta.id #dataanalyst")).toBeUndefined()
    expect(JobBoards.companyFromPost("Data Analyst at Jakarta - full time")).toBeUndefined()
  })
})
