export * as Boards from "./boards.js"

import { ScrapeChromium } from "./chromium.js"
import { JobBoards } from "./jobboards.js"

// fork: every job board the owner uses, read the way the site itself shows its results: its own public JSON endpoint,
// or the data the page renders, after using the page like a person would (search box, city filter). Boards that answer
// automated visits with a "humans only" check are not bypassed; the user gets the board's search link instead.

type Listing = JobBoards.Listing

const UA = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "application/json,text/html;q=0.9",
}
const getJson = async (url: string) => {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as any
}
const rupiah = (low?: number | null, high?: number | null) =>
  low || high
    ? `Rp ${[low, high]
        .filter((value): value is number => !!value)
        .map((value) => value.toLocaleString("id-ID"))
        .join(" – ")}`
    : undefined
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
const parse = (text: string | undefined) => {
  if (!text) return undefined
  try {
    return JSON.parse(text) as any
  } catch {
    return undefined
  }
}

/** Kalibrr: the board's own search endpoint, which honours text and location. Jobs carry the office street address. */
export async function fetchKalibrr(input: { role: string; cities: readonly string[] }): Promise<Listing[]> {
  const rows = await Promise.all(
    input.cities.map(async (city) => {
      // Up to three pages of 60. A short page is the last one, and so is a page mostly from other cities (Kalibrr
      // ignores a location it does not know and returns the whole country).
      const pages: Listing[][] = []
      const places = JobBoards.placesIn(city)
      for (const offset of [0, 60, 120]) {
        const data = await getJson(
          `https://www.kalibrr.com/kjs/job_board/search?limit=60&offset=${offset}&text=${encodeURIComponent(input.role)}&location=${encodeURIComponent(city)}`,
        ).catch(() => ({ jobs: [] }))
        const page = kalibrr(data)
        pages.push(page)
        if (page.length < 60 || page.filter((row) => JobBoards.inCities(row, places)).length < 30) break
      }
      return pages.flat()
    }),
  )
  return rows.flat()
}

/** Kalibrr search JSON to listings. google_location holds no coordinates, but often the street ("address_line_1"). */
export function kalibrr(data: unknown): Listing[] {
  return (((data as { jobs?: unknown[] } | undefined)?.jobs ?? []) as any[]).map((job) => {
    const place = job.google_location?.address_components ?? {}
    const street = typeof place.address_line_1 === "string" ? place.address_line_1.trim() : ""
    return {
      id: `kalibrr-${job.id}`,
      title: String(job.name ?? ""),
      company: job.company?.name ?? job.company_name,
      location: [place.city, place.region].filter(Boolean).join(", ") || undefined,
      ...(street ? { address: kalibrrAddress(street, place.city, place.region) } : {}),
      ...(typeof job.company_info?.url === "string" && /^https?:\/\//i.test(job.company_info.url) ? { website: job.company_info.url.trim() } : {}),
      salary:
        job.salary_shown === false
          ? undefined
          : (() => {
              const range = rupiah(job.base_salary, job.maximum_salary)
              return range && job.salary_interval ? `${range} per ${job.salary_interval}` : range
            })(),
      posted: job.activation_date ? String(job.activation_date).slice(0, 10) : undefined,
      url: `https://www.kalibrr.com/c/${job.company?.code ?? "company"}/jobs/${job.id}/${job.slug ?? slug(String(job.name ?? "job"))}`,
      board: "kalibrr",
    }
  })
}

/** Dealls: the public API its explore page calls. It has no city filter, so the city on each job decides later. */
export async function fetchDealls(input: { role: string }): Promise<Listing[]> {
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      getJson(
        `https://api.sejutacita.id/v1/explore-job/job?page=${page}&sortParam=mostRelevant&sortBy=asc&search=${encodeURIComponent(input.role)}&published=true&limit=18&status=active`,
      ).catch(() => ({ data: { docs: [] } })),
    ),
  )
  return pages.flatMap((data) =>
    ((data.data?.docs ?? []) as any[]).map((job) => ({
      id: `dealls-${job.id}`,
      title: String(job.role ?? ""),
      company: job.company?.name,
      location: [job.city?.name, job.workplaceType === "remote" ? "Remote" : undefined].filter(Boolean).join(", ") || undefined,
      salary: job.salaryRange ? rupiah(job.salaryRange.start, job.salaryRange.end) : undefined,
      posted: job.publishedAt ? String(job.publishedAt).slice(0, 10) : undefined,
      url: `https://dealls.com/loker/${job.slug}~${job.company?.slug ?? ""}`,
      board: "dealls",
    })),
  )
}

/** Glints: the explore page server-renders its results into __NEXT_DATA__ (Apollo cache); location is a chain of areas. */
export function glints(html: string): Listing[] {
  const cache = (parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1])?.props?.apolloCache ?? {}) as Record<string, any>
  const ref = (value: any) => (value && value.__ref ? cache[value.__ref] : value)
  return Object.entries(cache)
    .filter(([key, value]) => key.startsWith("Job:") && value?.title)
    .map(([, job]) => {
      const place = ref(job.location)
      const chain = [place?.formattedName, ...((place?.parents ?? []) as any[]).map((parent) => ref(parent)?.formattedName)].filter(Boolean)
      const salary = ((job.salaries ?? []) as any[]).map(ref).find((item) => item?.minAmount || item?.maxAmount)
      return {
        id: `glints-${job.id}`,
        title: String(job.title),
        company: ref(job.company)?.name,
        location: chain.slice(0, 3).join(", ") || ref(job.city)?.name,
        salary: job.shouldShowSalary && salary ? rupiah(salary.minAmount, salary.maxAmount) : undefined,
        posted: job.updatedAt ? String(job.updatedAt).slice(0, 10) : undefined,
        url: `https://glints.com/id/opportunities/jobs/${slug(String(job.title))}/${job.id}`,
        board: "glints",
      }
    })
}

/** Glints filters by a location id: open the explore page once to learn the id from its own lookup, then load the filtered list. */
export async function fetchGlints(input: { role: string; cities: readonly string[] }): Promise<Listing[]> {
  if (!ScrapeChromium.available()) return []
  const out: Listing[] = []
  for (const city of input.cities) {
    const base = `https://glints.com/id/opportunities/jobs/explore?keyword=${encodeURIComponent(input.role)}&country=ID&locationName=${encodeURIComponent(city)}`
    const first = await ScrapeChromium.script(base, async () => {}, { timeoutMs: 45_000, waitMs: 3000 }).catch(() => undefined)
    // The lookup lists cities ("Jakarta Selatan") with their provinces ("DKI Jakarta") as parents; "jakarta" is the province.
    const id = (first?.json ?? [])
      .filter((item) => item.url.includes("searchHierarchicalLocations"))
      .flatMap((item) => {
        const data = parse(item.body)?.data?.searchHierarchicalLocations
        return flatten((Array.isArray(data) ? data : (data?.list ?? [])) as GlintsPlace[])
      })
      .filter((place) => placeName(place.name) === placeName(city))
      .toSorted((a, b) => Math.abs(3 - a.level) - Math.abs(3 - b.level))[0]?.id
    // Without a location id the explore page still lists jobs for the keyword; the city on each card decides later.
    if (!id) {
      out.push(...(first ? glints(first.html) : []))
      continue
    }
    for (const page of [1, 2]) {
      const rendered = await ScrapeChromium.render(`${base}&locationId=${id}${page > 1 ? `&page=${page}` : ""}`, { timeoutMs: 45_000, waitMs: 2500 }).catch(
        () => undefined,
      )
      const found = rendered ? glints(rendered.html) : []
      out.push(...found)
      if (found.length < 25) break
    }
  }
  return out
}

/** Indeed: the result cards are embedded as JSON (mosaic provider data). */
export function indeed(html: string): Listing[] {
  const raw = html.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]*?\});/)?.[1]
  const results = (parse(raw)?.metaData?.mosaicProviderJobCardsModel?.results ?? []) as any[]
  return results.map((job) => ({
    id: `indeed-${job.jobkey}`,
    title: String(job.title ?? job.displayTitle ?? ""),
    company: job.company,
    location: job.formattedLocation,
    salary: job.salarySnippet?.text || undefined,
    posted: job.formattedRelativeTime,
    url: `https://id.indeed.com/viewjob?jk=${job.jobkey}`,
    board: "indeed",
  }))
}

export async function fetchIndeed(input: { role: string; cities: readonly string[] }): Promise<Listing[]> {
  if (!ScrapeChromium.available()) return []
  const out: Listing[] = []
  for (const city of input.cities) {
    for (const start of [0, 10]) {
      const rendered = await ScrapeChromium.render(
        `https://id.indeed.com/jobs?q=${encodeURIComponent(input.role)}&l=${encodeURIComponent(city)}${start ? `&start=${start}` : ""}`,
        { timeoutMs: 45_000, waitMs: 2500 },
      ).catch(() => undefined)
      const found = rendered ? indeed(rendered.html) : []
      out.push(...found)
      if (found.length < 10) break
    }
  }
  return out
}

/** KitaLulus: the list is in the page's server data ("vacancyList"). City pages are /lowongan/in-kota-<city> and /in-kabupaten-<city>. */
export function kitalulus(html: string): Listing[] {
  const text = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&")
  const start = text.indexOf('"vacancyList":{')
  if (start < 0) return []
  const open = text.indexOf("{", start)
  let depth = 0
  let end = open
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++
    if (text[end] === "}" && --depth === 0) break
  }
  const list = (parse(text.slice(open, end + 1))?.list ?? []) as any[]
  return list
    .filter((job) => !job.isClosed)
    .map((job) => ({
      id: `kitalulus-${job.id}`,
      title: String(job.positionName ?? ""),
      company: job.company?.name,
      location: [job.city?.name, job.province?.name].filter(Boolean).join(", ") || undefined,
      salary: rupiah(job.salaryLowerBound, job.salaryUpperBound),
      posted: job.updatedAtStr,
      url: `https://www.kitalulus.com/lowongan/detail/${job.slug}`,
      board: "kitalulus",
    }))
}

export async function fetchKitaLulus(input: { role: string; cities: readonly string[] }): Promise<Listing[]> {
  if (!ScrapeChromium.available()) return []
  const out: Listing[] = []
  for (const page of input.cities.flatMap((city) => [`in-kota-${slug(city)}`, `in-kabupaten-${slug(city)}`])) {
    const rendered = await ScrapeChromium.render(`https://www.kitalulus.com/lowongan/${page}?keyword=${encodeURIComponent(input.role)}`, {
      timeoutMs: 40_000,
      waitMs: 2500,
    }).catch(() => undefined)
    if (rendered) out.push(...kitalulus(rendered.html))
  }
  return out
}

/** Loker.id: its search page loads results from its own JSON data route, which honours the keyword; the city comes from each job. */
export function lokerid(data: unknown): Listing[] {
  const jobs = ((data as { jobs?: unknown[] } | undefined)?.jobs ?? []) as any[]
  return jobs.map((job) => {
    const category = (job.categories ?? [])[0]
    return {
      id: `lokerid-${job.id}`,
      title: String(job.title ?? ""),
      company: job.company_name,
      location: ((job.locations ?? []) as any[]).map((place) => [place.name, place.parent?.name].filter(Boolean).join(", ")).join("; ") || job.location,
      salary: job.is_hide_salary ? undefined : job.salary?.name || rupiah(job.salary_min, job.salary_max),
      posted: job.display_date ? String(job.display_date).slice(0, 10) : undefined,
      url: category?.parent?.slug ? `https://www.loker.id/${category.parent.slug}/${category.slug}/${job.slug}.html` : `https://www.loker.id/cari-lowongan-kerja?q=${encodeURIComponent(String(job.title ?? ""))}`,
      board: "lokerid",
    }
  })
}

export async function fetchLokerId(input: { role: string }): Promise<Listing[]> {
  if (!ScrapeChromium.available()) return []
  const page = await ScrapeChromium.script(`https://www.loker.id/cari-lowongan-kerja?q=${encodeURIComponent(input.role)}`, async (tab) => {
    await tab.scroll(1)
  }, { timeoutMs: 60_000, waitMs: 3000 }).catch(() => undefined)
  const data =
    (page?.json ?? []).filter((item) => item.url.includes("_data=routes%2F_lowongan.cari-lowongan-kerja")).map((item) => parse(item.body)).find((body) => Array.isArray(body?.jobs)) ??
    // A direct visit is server-rendered: the same data sits in the page's Remix context.
    { jobs: parse(jsonArrayAt(page?.html ?? "", '"jobs":[')) ?? [] }
  return lokerid(data)
}

/** The JSON array that starts right after `marker` in `text`, cut at its matching bracket (strings respected). */
function jsonArrayAt(text: string, marker: string) {
  const start = text.indexOf(marker)
  if (start < 0) return undefined
  const open = start + marker.length - 1
  let depth = 0
  let quoted = false
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === "\\") index++
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === "[" || char === "{") depth++
    else if ((char === "]" || char === "}") && --depth === 0) return text.slice(open, index + 1)
  }
  return undefined
}

/** Karir.com: results are server-rendered cards; a card opens its detail inside the page (no own address), so the link is the search. */
export async function fetchKarir(input: { role: string; cities: readonly string[] }): Promise<Listing[]> {
  if (!ScrapeChromium.available()) return []
  const out: Listing[] = []
  for (const city of input.cities) {
    const search = `https://karir.com/search-lowongan?keyword=${encodeURIComponent(input.role)}&location=${encodeURIComponent(city)}`
    const page = await ScrapeChromium.script(search, async () => {}, { timeoutMs: 45_000, waitMs: 3000 }).catch(() => undefined)
    if (!page) continue
    out.push(...karir(page.html, search))
  }
  return out
}

/** One card per `info-company-stack`: title (Heading4), then company, salary, city and date as plain lines. */
export function karir(html: string, search: string): Listing[] {
  return html
    .split(/info-company-stack/)
    .slice(1)
    .flatMap((chunk, index) => {
      const lines = chunk
        .split(/<\/p>/)
        .map((part) => part.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
        .filter((line) => line && !line.startsWith('"'))
      const title = chunk.match(/type="Heading4"[^>]*>([^<]+)</)?.[1]?.trim()
      if (!title) return []
      const rest = lines.filter((line) => line !== title && !/^\d+$/.test(line))
      return [
        {
          id: `karir-${index}-${title}`,
          title,
          company: rest[0],
          salary: rest.find((line) => /Rp/.test(line)),
          location: rest.find((line) => !/Rp|\d{4}/.test(line) && line !== rest[0]),
          posted: rest.find((line) => /\d{4}/.test(line) && !/Rp/.test(line)),
          url: search,
          board: "karir",
        },
      ]
    })
}

/** Boards that cannot be read automatically, with the reason. Never bypassed: the user gets the board's search link. */
export const manualSearch = (input: { role: string; cities: readonly string[] }) => [
  {
    board: "glassdoor",
    url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(input.role)}&locKeyword=${encodeURIComponent(`${input.cities[0] ?? ""}, Indonesia`)}`,
    note: 'Glassdoor menolak akses otomatis (cek "Humans only"); buka link ini sendiri.',
  },
  {
    board: "jobs.id",
    url: "https://www.jobs.id/",
    note: "Sertifikat HTTPS situs jobs.id sendiri tidak valid (browser menampilkan \"Privacy error\"), jadi tidak dibaca.",
  },
  {
    board: "topkarir",
    url: "https://www.topkarir.com/",
    note: "TopKarir tidak merespons (koneksi timeout) saat dicek.",
  },
]

export type Report = {
  board: string
  /** Listings read (before dedupe). */
  count: number
  error?: string
  /** Searches (role phrase × city) run, and those left out because the time budget ran out. */
  searches?: number
  skipped?: number
}

export type Search = { board: string; phrase: string; city?: string }

type Board = { board: string; perCity: boolean; browser: boolean; run: (role: string, city?: string) => Promise<Listing[]> }

const BOARDS: readonly Board[] = [
  { board: "kalibrr", perCity: true, browser: false, run: (role, city) => fetchKalibrr({ role, cities: [city!] }) },
  { board: "dealls", perCity: false, browser: false, run: (role) => fetchDealls({ role }) },
  { board: "jobstreet", perCity: true, browser: true, run: (role, city) => JobBoards.fetchJobstreet({ role, cities: [city!], pages: 2 }) },
  { board: "linkedin", perCity: true, browser: true, run: (role, city) => JobBoards.fetchLinkedIn({ role, cities: [city!], pages: 2 }) },
  { board: "glints", perCity: true, browser: true, run: (role, city) => fetchGlints({ role, cities: [city!] }) },
  { board: "indeed", perCity: true, browser: true, run: (role, city) => fetchIndeed({ role, cities: [city!] }) },
  { board: "kitalulus", perCity: true, browser: true, run: (role, city) => fetchKitaLulus({ role, cities: [city!] }) },
  { board: "lokerid", perCity: false, browser: true, run: (role) => fetchLokerId({ role }) },
  { board: "karir", perCity: true, browser: true, run: (role, city) => fetchKarir({ role, cities: [city!] }) },
]

// Board answers for the same search are reused for an hour, so a second research call in one session is quick.
const CACHE_TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; rows: Listing[] }>()

/**
 * Every board, for every role phrase and every city: one search per board × phrase × city (boards without a city filter
 * once per phrase). Browser boards run a few at a time, JSON boards alongside; each search has its own time limit, and
 * searches not started within the budget are reported (never silently dropped). The main phrase goes first in every
 * city, then the other phrases.
 */
export async function fetchAll(input: {
  phrases: readonly string[]
  cities: readonly string[]
  budgetMs?: number
  concurrency?: number
  /** "quick": only the boards with a JSON API; "browser": only those read with the browser; omitted: all. */
  kind?: "quick" | "browser"
  onProgress?: (line: string) => void
  /** Each search's listings as soon as it finishes. */
  onListings?: (listings: readonly Listing[]) => void
}): Promise<{ listings: Listing[]; reports: Report[]; skipped: Search[] }> {
  const chosen = BOARDS.filter((board) => input.kind === undefined || board.browser === (input.kind === "browser"))
  const cityBoards = chosen.filter((board) => board.perCity)
  const wide = input.phrases.flatMap((phrase) =>
    chosen.filter((board) => !board.perCity).map((board) => ({ board, phrase, city: undefined as string | undefined })),
  )
  // The main phrase in every city first, then the other phrases city by city, busiest city first.
  const main = input.phrases.slice(0, 1)
  const others = input.phrases.slice(1)
  const searches = [
    ...main.flatMap((phrase) => input.cities.flatMap((city) => cityBoards.map((board) => ({ board, phrase, city: city as string | undefined })))),
    ...wide,
    ...input.cities.flatMap((city) => others.flatMap((phrase) => cityBoards.map((board) => ({ board, phrase, city: city as string | undefined })))),
  ]
  const deadline = Date.now() + (input.budgetMs ?? Number(process.env.OPENCODE_BOARDS_BUDGET_MS ?? 240_000))
  const results: { search: (typeof searches)[number]; rows: Listing[]; error?: string; skipped?: boolean }[] = []
  const pool = async (queue: typeof searches) => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const search = next
      if (Date.now() > deadline) {
        results.push({ search, rows: [], skipped: true })
        continue
      }
      const key = `${search.board.board}|${search.phrase}|${search.city ?? ""}`
      const hit = cache.get(key)
      const result =
        hit && Date.now() - hit.at < CACHE_TTL
          ? { rows: hit.rows, error: undefined as string | undefined }
          : await Promise.race([
              search.board.run(search.phrase, search.city),
              // A search started near the end of the budget gets at most 30 s past it.
              new Promise<never>((_, reject) => {
                const limit = Math.max(30_000, Math.min(120_000, deadline - Date.now() + 30_000))
                setTimeout(() => reject(new Error(`took longer than ${Math.round(limit / 1000)} s`)), limit)
              }),
            ]).then(
              (rows) => {
                cache.set(key, { at: Date.now(), rows })
                return { rows, error: undefined as string | undefined }
              },
              (error: unknown) => ({ rows: [] as Listing[], error: error instanceof Error ? error.message : String(error) }),
            )
      const rows = result.rows.map((row) => ({ ...row, phrase: row.phrase ?? search.phrase }))
      results.push({ search, rows, ...(result.error ? { error: result.error } : {}) })
      if (rows.length) input.onListings?.(rows)
      input.onProgress?.(
        `${search.board.board} "${search.phrase}"${search.city ? ` ${search.city}` : ""}: ${rows.length} (${results.length}/${searches.length})`,
      )
    }
  }
  const browser = searches.filter((search) => search.board.browser)
  const plain = searches.filter((search) => !search.board.browser)
  const workers = Math.max(1, input.concurrency ?? Number(process.env.OPENCODE_BOARDS_CONCURRENCY ?? 4))
  await Promise.all([
    ...Array.from({ length: workers }, () => pool(browser)),
    ...Array.from({ length: 3 }, () => pool(plain)),
  ])
  const order = new Map(searches.map((search, index) => [search, index]))
  const ordered = results.toSorted((a, b) => order.get(a.search)! - order.get(b.search)!)
  const reports = BOARDS.flatMap((board) => {
    const mine = ordered.filter((result) => result.search.board === board)
    if (!mine.length) return []
    const error = mine.find((result) => result.error)?.error
    const skipped = mine.filter((result) => result.skipped).length
    return [
      {
        board: board.board,
        count: mine.reduce((sum, result) => sum + result.rows.length, 0),
        searches: mine.length - skipped,
        ...(skipped ? { skipped } : {}),
        ...(error ? { error } : {}),
      },
    ]
  })
  return {
    listings: JobBoards.dedupe(ordered.flatMap((result) => result.rows)),
    reports,
    skipped: ordered
      .filter((result) => result.skipped)
      .map((result) => ({ board: result.search.board.board, phrase: result.search.phrase, ...(result.search.city ? { city: result.search.city } : {}) })),
  }
}

/**
 * Kalibrr's Google address in the form geocoders find: "27, Jalan Tomang Raya, Tomang Kel., Grogol Petamburan" + "West
 * Jakarta" → "Jalan Tomang Raya 27, Tomang, Grogol Petamburan, Jakarta Barat". RT/RW numbers and "Kel." confuse
 * Nominatim, which also knows the cities by their Indonesian names.
 */
export function kalibrrAddress(street: string, city?: string, region?: string) {
  const parts = street
    .replace(/\bRT\s*\.?\s*\d+\s*\/\s*RW\s*\.?\s*\d+\b/gi, "")
    .replace(/\s+Kel\.?(?=,|$)/gi, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  // A leading house number belongs after the street name.
  const ordered = parts.length > 1 && /^\d+[a-z]?$/i.test(parts[0]!) ? [`${parts[1]} ${parts[0]}`, ...parts.slice(2)] : parts
  const local = (value: string | undefined) =>
    value
      ?.replace(/^(South|Central|West|East|North) Jakarta$/i, (_, side: string) => `Jakarta ${SIDE[side.toLowerCase()]}`)
      .replace(/^South Tangerang$/i, "Tangerang Selatan")
      .replace(/^(.+) Regency$/i, "Kabupaten $1")
      .replace(/\s*\(.*\)$/, "")
  // A street that already names its city keeps it: Kalibrr's city field is sometimes wrong (Kompas Gramedia in "Purwakarta").
  const named = JobBoards.placesIn(street).length > 0
  return [...ordered, ...(named ? [] : [local(city), local(region)])].filter((part): part is string => !!part).join(", ")
}

const SIDE: Record<string, string> = { south: "Selatan", central: "Pusat", west: "Barat", east: "Timur", north: "Utara" }

type GlintsPlace = { id: string; name: string; level: number; parents?: GlintsPlace[] }

function flatten(places: readonly GlintsPlace[]): GlintsPlace[] {
  return places.flatMap((place) => [place, ...flatten(place.parents ?? [])])
}

/** "DKI Jakarta", "Kota Jakarta Selatan", "Kab. Tangerang" → comparable names. */
function placeName(name: string | undefined) {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(dki|kota|kabupaten|kab\.?|city|regency|daerah khusus ibukota)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
}
