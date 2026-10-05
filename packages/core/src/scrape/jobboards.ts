export * as JobBoards from "./jobboards.js"

import { ScrapeChromium } from "./chromium.js"

// fork: job search through plain web search returned a few snippets, many in the wrong city and with links that were not
// the listing. Job boards render their result lists as structured cards (title, company, city, salary, listing link), so
// the list is read from the board itself with the browser tier and filtered by the city printed on each card.

export type Listing = { id: string; title: string; company?: string; location?: string; salary?: string; posted?: string; summary?: string; url: string; board: string }

const KNOWN_CITIES = [
  "bandung", "cimahi", "bandung barat", "jakarta", "tangerang", "tangerang selatan", "bekasi", "depok", "bogor", "surabaya", "sidoarjo", "malang",
  "yogyakarta", "semarang", "solo", "medan", "makassar", "denpasar", "bali", "batam", "palembang", "balikpapan", "karawang", "cikarang", "serpong", "bsd",
]
const STOP = new Set(["lowongan", "loker", "kerja", "job", "jobs", "di", "untuk", "perusahaan", "dan", "yang", "atau", "semua", "cari", "carikan", "relevan", "terbaru", "sumber", "website", "company", "langsung", "indonesia", "jawa", "barat", "banten", "timur", "tengah", "site", "career", "careers", "karir", "karier", "official", "resmi", "portal", "web", "kantor", "pusat", "hq", "lamar", "link", "posisi", "tolong", "dong", "aja", "saja", "semuanya", "cimahi"])

/** Known cities named in the question or location text. */
export function cities(query: string, location?: string) {
  const text = ` ${query} ${location ?? ""} `.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ")
  return KNOWN_CITIES.filter((city) => text.includes(` ${city} `))
}

/** The job title words left once cities and filler words are removed ("data analyst"). */
export function role(query: string, places: readonly string[]) {
  const drop = new Set(places.flatMap((place) => place.split(" ")))
  return query
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word) && !drop.has(word))
    .join(" ")
}

const text = (html: string) =>
  html
    .replace(/<!--.*?-->/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

const field = (card: string, automation: string) => {
  const match = card.match(new RegExp(`data-automation="${automation}"[^>]*>(.*?)</(?:a|span|div|p)>`, "s"))
  return match ? text(match[1] ?? "") : undefined
}

/** Jobstreet result page (HTML after scripts ran) to listings. Each card is one <article>. */
export function jobstreet(html: string, base = "https://id.jobstreet.com"): Listing[] {
  return html
    .split(/<article\b/)
    .slice(1)
    .flatMap((chunk) => {
      const card = chunk.split("</article>")[0] ?? ""
      const id = card.match(/id="job-title-(\d+)"/)?.[1]
      const title = field(card, "jobTitle")
      if (!id || !title) return []
      const salary = card.match(/aria-label="Salary:\s*([^"]+)"/)?.[1]
      return [
        {
          id,
          title,
          company: field(card, "jobCompany"),
          location: field(card, "jobLocation"),
          salary: salary ? text(salary) : undefined,
          posted: field(card, "jobListingDate"),
          summary: field(card, "jobShortDescription")?.slice(0, 400),
          url: `${base}/id/job/${id}`,
          board: "jobstreet",
        },
      ]
    })
}

/** True when the card's own city text names one of the wanted cities. A bare province ("Jawa Barat") does not count. */
export function inCities(listing: Pick<Listing, "location">, places: readonly string[]) {
  const where = (listing.location ?? "").toLowerCase()
  return places.some((place) => new RegExp(`(^|[^a-z])${place}([^a-z]|$)`).test(where))
}

/** Up to `pages` result pages per city from Jobstreet; one failed page never loses the others. */
export async function fetchJobstreet(input: { role: string; cities: readonly string[]; pages?: number }): Promise<Listing[]> {
  if (!ScrapeChromium.available() || !input.role) return []
  const seen = new Map<string, Listing>()
  for (const city of input.cities.slice(0, 3)) {
    for (let page = 1; page <= (input.pages ?? 3); page++) {
      const url = `https://id.jobstreet.com/id/jobs?keywords=${encodeURIComponent(input.role)}&where=${encodeURIComponent(city)}${page > 1 ? `&page=${page}` : ""}`
      const rendered = await ScrapeChromium.render(url, { timeoutMs: 45_000, waitMs: 2500 }).catch(() => undefined)
      const found = rendered ? jobstreet(rendered.html) : []
      found.forEach((listing) => seen.set(listing.id, listing))
      if (found.length < 20) break
    }
  }
  return [...seen.values()]
}

/** LinkedIn public search page (no login) to listings. Each card is one <li> with a base-search-card. */
export function linkedin(html: string): Listing[] {
  return html
    .split(/<li>\s*<div class="base-card/)
    .slice(1)
    .flatMap((chunk) => {
      const card = chunk.split("</li>")[0] ?? ""
      const id = card.match(/urn:li:jobPosting:(\d+)/)?.[1]
      const title = card.match(/base-search-card__title">(.*?)<\/h3>/s)?.[1]
      if (!id || !title) return []
      return [
        {
          id,
          title: text(title),
          company: text(card.match(/base-search-card__subtitle">(.*?)<\/h4>/s)?.[1] ?? "") || undefined,
          location: text(card.match(/job-search-card__location">(.*?)<\/span>/s)?.[1] ?? "") || undefined,
          posted: text(card.match(/<time[^>]*>(.*?)<\/time>/s)?.[1] ?? "") || undefined,
          url: `https://www.linkedin.com/jobs/view/${id}`,
          board: "linkedin",
        },
      ]
    })
}

/** Up to `pages` public result pages per city from LinkedIn. */
export async function fetchLinkedIn(input: { role: string; cities: readonly string[]; pages?: number }): Promise<Listing[]> {
  if (!ScrapeChromium.available() || !input.role) return []
  const seen = new Map<string, Listing>()
  for (const city of input.cities.slice(0, 3)) {
    for (let page = 0; page < (input.pages ?? 2); page++) {
      const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(input.role)}&location=${encodeURIComponent(`${city}, Indonesia`)}&f_TPR=r2592000${page > 0 ? `&start=${page * 25}` : ""}`
      const rendered = await ScrapeChromium.render(url, { timeoutMs: 45_000, waitMs: 2500 }).catch(() => undefined)
      const found = rendered ? linkedin(rendered.html) : []
      found.forEach((listing) => seen.set(listing.id, listing))
      if (found.length < 20) break
    }
  }
  return [...seen.values()]
}

/** Same job on two boards: keep the first. */
export function dedupe(listings: readonly Listing[]) {
  const key = (listing: Listing) => `${(listing.company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")}|${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "")}`
  return [...new Map(listings.map((listing) => [key(listing), listing])).values()]
}

const BOARD_HOSTS = /(^|\.)(jobstreet|linkedin|glints|indeed|kalibrr|jobsdb|karir|jooble|loker|lokerid|facebook|instagram|tiktok|youtube|wikipedia|x|twitter|glassdoor|topkarir|talenta|dealls)\./i

/** A search hit that is the employer's own site, not a job board or social page. */
export const isOfficialHost = (url: string) => {
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return ""
    }
  })()
  return host !== "" && !BOARD_HOSTS.test(host)
}

const plain = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Opens the employer's own career page (first non-board search hit, career-looking addresses first) with the browser tier and
 * reports what it shows for the role. Never guesses: an unreadable page is reported as unreadable.
 */
export async function careerCheck(hits: readonly { url: string }[], input: { company: string; role: string }): Promise<{ company: string; url?: string; note: string }> {
  const official = hits.filter((hit) => isOfficialHost(hit.url))
  const pick = official.find((hit) => /karir|karier|career|jobs|recruit|lowongan|join/i.test(hit.url)) ?? official[0]
  if (!pick) return { company: input.company, note: "Situs resmi tidak ditemukan lewat pencarian" }
  if (!ScrapeChromium.available()) return { company: input.company, url: pick.url, note: "Browser tidak tersedia, halaman tidak dibuka" }
  const rendered = await ScrapeChromium.render(pick.url, { timeoutMs: 35_000, waitMs: 3000 }).catch(() => undefined)
  if (!rendered) return { company: input.company, url: pick.url, note: "Tidak bisa dibuka (timeout atau diblokir)" }
  const body = plain(rendered.html)
  if (body.length < 200) return { company: input.company, url: rendered.finalUrl, note: "Halaman hampir kosong (daftar dimuat setelah login atau interaksi)" }
  const words = input.role.toLowerCase().split(" ").filter(Boolean)
  const lower = body.toLowerCase()
  const at = words.length > 0 && words.every((word) => lower.includes(word)) ? lower.indexOf(words[0] ?? "") : -1
  if (at >= 0) return { company: input.company, url: rendered.finalUrl, note: `Ada kata "${input.role}": …${body.slice(Math.max(0, at - 40), at + 80)}…` }
  const none = /0 jobs|no jobs|tidak ada lowongan|belum ada lowongan|no open positions/i.test(body)
  return { company: input.company, url: rendered.finalUrl, note: none ? "Dibuka: halaman menyatakan tidak ada lowongan" : `Dibuka: tidak ada posisi ${input.role} yang tampil` }
}

/** "Analyst (Bangkok Based, relocation provided)": the card says Bandung but the job is elsewhere. */
export function basedElsewhere(title: string, places: readonly string[]) {
  const based = title.toLowerCase().match(/\(([a-z ]+?)\s+based\b/)?.[1]?.trim()
  return !!based && !places.some((place) => based.includes(place))
}

// Indonesian and English spellings of the same job words ("Data Analis" is a Data Analyst job).
const SPELLINGS: Record<string, string[]> = {
  analyst: ["analyst", "analis", "analytics"],
  analis: ["analis", "analyst"],
  engineer: ["engineer", "insinyur"],
  developer: ["developer", "pengembang", "programmer"],
  accountant: ["accountant", "akuntan", "accounting"],
  akuntan: ["akuntan", "accountant", "accounting"],
  marketing: ["marketing", "pemasaran"],
  admin: ["admin", "administrasi", "administration"],
}

/** True when the title contains the word or one of its spellings. */
export function titleHas(title: string, word: string) {
  const lower = title.toLowerCase()
  return (SPELLINGS[word] ?? [word]).some((spelling) => lower.includes(spelling))
}
