export * as JobBoards from "./jobboards.js"

import { MapsCompany } from "../maps/company.js"
import { NetGuard } from "../net-guard.js"
import { ScrapeChromium } from "./chromium.js"

// fork: job search through plain web search returned a few snippets, many in the wrong city and with links that were not
// the listing. Job boards render their result lists as structured cards (title, company, city, salary, listing link), so
// the list is read from the board itself with the browser tier and filtered by the city printed on each card.

export type Listing = {
  id: string
  title: string
  company?: string
  location?: string
  /** Street address of the office when the board or the posting's JSON-LD gives one. */
  address?: string
  latitude?: number
  longitude?: number
  salary?: string
  posted?: string
  summary?: string
  url: string
  board: string
  /** The employer's own website when the board shows it (Kalibrr's company profile). */
  website?: string
  /** The role phrase whose board search found this listing. */
  phrase?: string
}

// Canonical city and town names, longest first when matched so "tangerang selatan" is never also "tangerang".
const KNOWN_CITIES = [
  "bandung", "cimahi", "bandung barat", "jakarta", "jakarta pusat", "jakarta selatan", "jakarta barat", "jakarta timur", "jakarta utara",
  "tangerang", "tangerang selatan", "kabupaten tangerang", "bekasi", "kabupaten bekasi", "depok", "bogor", "kabupaten bogor", "lebak",
  "surabaya", "sidoarjo", "malang", "yogyakarta", "semarang", "solo", "medan", "makassar", "denpasar", "bali", "batam", "palembang",
  "balikpapan", "karawang", "cikarang", "serpong", "bsd", "cisauk", "pagedangan", "parungpanjang", "tigaraksa", "maja", "rangkasbitung",
  "citayam", "bojonggede", "cibinong", "cilebut", "tambun", "cibitung", "ciputat", "pamulang", "bintaro", "alam sutera", "karawaci",
  "cikupa", "balaraja",
]
// A town or district counts for the city or regency it lies in.
const PARENT: Record<string, string> = {
  "jakarta pusat": "jakarta", "jakarta selatan": "jakarta", "jakarta barat": "jakarta", "jakarta timur": "jakarta", "jakarta utara": "jakarta",
  "bandung barat": "bandung", serpong: "tangerang selatan", bsd: "tangerang selatan", ciputat: "tangerang selatan", pamulang: "tangerang selatan",
  bintaro: "tangerang selatan", "alam sutera": "tangerang selatan", cisauk: "kabupaten tangerang", pagedangan: "kabupaten tangerang",
  tigaraksa: "kabupaten tangerang", cikupa: "kabupaten tangerang", balaraja: "kabupaten tangerang", karawaci: "tangerang",
  parungpanjang: "kabupaten bogor", bojonggede: "kabupaten bogor", cibinong: "kabupaten bogor", cilebut: "kabupaten bogor",
  citayam: "depok", maja: "lebak", rangkasbitung: "lebak", cikarang: "kabupaten bekasi", tambun: "kabupaten bekasi",
  cibitung: "kabupaten bekasi",
}
// English and short forms boards print ("South Jakarta", "Tangsel", "Kab. Tangerang", "Jakarta Metropolitan Area").
const SPELLED: readonly [RegExp, string][] = [
  [/\b(south jakarta|jaksel)\b/g, "jakarta selatan"],
  [/\b(central jakarta|jakpus)\b/g, "jakarta pusat"],
  [/\b(west jakarta|jakbar)\b/g, "jakarta barat"],
  [/\b(east jakarta|jaktim)\b/g, "jakarta timur"],
  [/\b(north jakarta|jakut)\b/g, "jakarta utara"],
  [/\b(south tangerang|tangsel)\b/g, "tangerang selatan"],
  [/\b(kabupaten|kab) tangerang\b|\btangerang regency\b/g, "kabupaten tangerang"],
  [/\b(kabupaten|kab) bekasi\b|\bbekasi regency\b/g, "kabupaten bekasi"],
  [/\b(kabupaten|kab) bogor\b|\bbogor regency\b/g, "kabupaten bogor"],
  [/\b(kabupaten|kab) lebak\b|\blebak regency\b/g, "lebak"],
  [/\bparung panjang\b/g, "parungpanjang"],
  [/\bbojong gede\b/g, "bojonggede"],
  [/\brangkas bitung\b/g, "rangkasbitung"],
  [/\bbumi serpong damai\b/g, "bsd"],
  [/\balam sutra\b/g, "alam sutera"],
  [/\b(jakarta metropolitan area|greater jakarta|jabodetabek|dki jakarta|daerah khusus ibukota jakarta|jakarta raya|special capital region of jakarta)\b/g, "jakarta"],
  [/\b(kota|city of|adm|administrasi)\b/g, " "],
]
// Cities each line runs through: the boards are searched in these, and listings in them are kept.
const LINE_CITIES: Record<string, readonly string[]> = {
  bogor: ["jakarta", "depok", "bogor", "kabupaten bogor"],
  cikarang: ["jakarta", "bekasi", "kabupaten bekasi"],
  rangkasbitung: ["jakarta", "tangerang selatan", "kabupaten tangerang", "kabupaten bogor", "lebak"],
  tangerang: ["jakarta", "tangerang"],
  "tanjung-priok": ["jakarta"],
  "mrt-jakarta": ["jakarta"],
  "lrt-jakarta": ["jakarta"],
  "lrt-jabodebek": ["jakarta", "bekasi", "depok", "kabupaten bogor"],
}
// Names the boards understand, most listings first; a regency is searched under its main town.
const SEARCH_NAME: Record<string, string> = {
  "kabupaten tangerang": "tangerang",
  "kabupaten bogor": "bogor",
  "kabupaten bekasi": "cikarang",
  lebak: "rangkasbitung",
}
const SEARCH_ORDER = ["jakarta", "tangerang selatan", "tangerang", "bekasi", "depok", "bogor", "cikarang", "rangkasbitung"]

const STOP = new Set(
  (
    "lowongan loker lokernya kerja pekerjaan job jobs vacancy vacancies hiring rekrutmen di untuk perusahaan perusahaannya dan yang yg atau semua cari carikan carikan mencari tolong dong aja saja relevan terbaru sumber website company companies langsung indonesia jawa barat banten timur tengah selatan utara pusat site career careers karir karier official resmi portal web kantor pusat hq lamar link posisi semuanya sejenis sejenisnya serupa setara terkait related similar dll dsb etc lain lainnya buka membuka dibuka open opening openings thorough menyeluruh lengkap linkedin ig instagram facebook fb twitter post posts postingan jobstreet glints kalibrr indeed dealls kitalulus karir.com dekat line jalur wajib krl stasiun radius km meter lokasi gaji atas juta jt rp idr sebagai jadi bisa boleh harus mau ingin pengen please list daftar the an of for in at with near ada punya juga sama the bidang dibidang role roles position positions full time fulltime part parttime kontrak contract permanent tetap remote hybrid wfo wfh baru fresh graduate freshgraduate entry level kak min gan mas mbak bang list jelas tsb tersebut hemat ongkos kaki jalan").split(
      " ",
    ),
)
// Words that end the job part of a sentence: "data analyst dengan gaji …", "… lokasi dekat stasiun …".
const CUT = /(?<![\p{L}\p{N}])(dengan|dgn|gaji|salary|lokasi|lokasinya|radius|jarak|dekat|deket|sekitar|seputar|dari|near|within|around|wajib|harus|minimal|maksimal|maks|max|di\s+atas|diatas|above|budget|jalan\s+kaki|krl|stasiun|mrt|lrt|line|jalur|kantornya|yang\s+lokasinya|di(?!\s+bidang))(?![\p{L}\p{N}])/iu
const SIMILAR = /(?<![\p{L}])(sejenis|sejenisnya|serupa|setara|relevan|related|similar|terkait|semacamnya|dll|dsb|etc)(?![\p{L}])/iu
// Job title words; a group of words without one is not a role ("hemat ongkos").
const ROLE_NOUNS = new Set(
  "analyst analis analytics scientist engineer developer programmer manager staff admin administrator administrasi officer specialist spesialis designer desainer accountant akuntan accounting marketing sales intern internship magang consultant konsultan executive supervisor lead head director direktur architect operator teknisi technician driver kasir cashier guru teacher perawat nurse dokter apoteker writer penulis editor researcher peneliti auditor recruiter hrd finance keuangan legal assistant asisten secretary sekretaris coordinator koordinator associate representative agent barista chef cook koki tester qa intelligence".split(
    " ",
  ),
)
// Role phrases recognised inside a run of words ("data analyst bi reporting analyst").
const KNOWN_PHRASES = [
  "business intelligence analyst", "data analyst", "data analis", "analis data", "business intelligence", "bi analyst", "bi developer",
  "reporting analyst", "data scientist", "data engineer", "business analyst", "data analytics", "financial analyst", "system analyst",
  "software engineer", "machine learning engineer",
]
// Asked for "data analyst atau sejenisnya": these titles are the same job family. Data scientist only when asked.
const FAMILY: Record<string, readonly string[]> = {
  "data analyst": ["data analyst", "business intelligence", "bi analyst", "reporting analyst"],
  "data analis": ["data analyst", "business intelligence", "bi analyst", "reporting analyst"],
  "analis data": ["data analyst", "business intelligence", "bi analyst", "reporting analyst"],
  "data analytics": ["data analyst", "business intelligence", "bi analyst", "reporting analyst"],
  "business intelligence": ["business intelligence", "bi analyst", "data analyst", "reporting analyst"],
  "business intelligence analyst": ["business intelligence", "bi analyst", "data analyst", "reporting analyst"],
  "bi analyst": ["bi analyst", "business intelligence", "data analyst", "reporting analyst"],
  "reporting analyst": ["reporting analyst", "data analyst", "business intelligence", "bi analyst"],
}
// Words too common to make a title "similar" on their own ("Cyber Security Analyst" is not a data job).
const GENERIC_ROLE = new Set(
  "analyst analis analytics staff specialist spesialis officer senior junior intern internship magang manager lead head executive associate business engineer developer assistant asisten supervisor coordinator koordinator sr jr".split(
    " ",
  ),
)

/** Known cities and towns named in the question or location text, in list order. */
export function cities(query: string, location?: string) {
  const found = placesIn(`${query} ${location ?? ""}`)
  return KNOWN_CITIES.filter((city) => found.includes(city))
}

/** Canonical city and town names in a location text ("South Jakarta, DKI Jakarta" → ["jakarta selatan", "jakarta"]). */
export function placesIn(text: string | undefined) {
  const spelled = SPELLED.reduce(
    (value, entry) => value.replace(entry[0], entry[1]),
    ` ${(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `,
  ).replace(/\s+/g, " ")
  // A matched name is cut out, so the shorter names inside it ("tangerang" in "tangerang selatan") are not found again.
  return KNOWN_CITIES.toSorted((a, b) => b.length - a.length).reduce<{ rest: string; found: string[] }>(
    (state, city) =>
      state.rest.includes(` ${city} `)
        ? { rest: state.rest.replaceAll(` ${city} `, " | "), found: [...state.found, city] }
        : state,
    { rest: spelled, found: [] },
  ).found
}

/**
 * True when the card's own city text names one of the wanted cities (a district counts for its city: "Setiabudi,
 * Jakarta Selatan" is Jakarta). A bare province ("Jawa Barat"), another city, or "Tangerang" for "Tangerang Selatan"
 * does not count.
 */
export function inCities(listing: Pick<Listing, "location">, places: readonly string[]) {
  const found = placesIn(listing.location)
  const specific = found.filter((place) => place !== "jakarta" || !found.some((other) => other.startsWith("jakarta ")))
  return specific.some((place) => places.includes(place) || chain(place).some((parent) => places.includes(parent)))
}

/** Every city a set of lines runs through (Jakarta and its five cities included). */
export function lineCities(lines: readonly string[]) {
  const cities = lines.flatMap((line) => LINE_CITIES[line] ?? ["jakarta"])
  const all = [...new Set(cities)]
  return all.includes("jakarta")
    ? [...all, "jakarta pusat", "jakarta selatan", "jakarta barat", "jakarta timur", "jakarta utara"]
    : all
}

/** The names to type into the boards' city filters for these cities, busiest first. */
export function searchCities(places: readonly string[]) {
  const unique = [
    ...new Set(
      places.map((place) => {
        const city = SEARCH_NAME[place] ? place : (PARENT[place] ?? place)
        return city.startsWith("jakarta") ? "jakarta" : (SEARCH_NAME[city] ?? city)
      }),
    ),
  ]
  return [
    ...SEARCH_ORDER.filter((place) => unique.includes(place)),
    ...unique.filter((place) => !SEARCH_ORDER.includes(place)),
  ]
}

/**
 * The job titles a question asks for, as separate phrases: "data analyst atau sejenisnya … gaji di atas 11 juta …
 * dekat KRL" → ["data analyst", "business intelligence", "bi analyst", "reporting analyst"]. Salary, place, distance
 * and filler words never become part of a title.
 */
export function phrases(query: string, places: readonly string[] = []) {
  const lower = query.toLowerCase()
  const drop = new Set([...places, ...KNOWN_CITIES].flatMap((place) => place.split(" ")))
  const segments = lower
    .split(/[.;!?\n]+/)
    .map((clause) => {
      const at = clause.search(CUT)
      return at < 0 ? clause : clause.slice(0, at)
    })
    .flatMap((clause) => clause.split(/,|\/|&|\+(?!\+)|(?<![\p{L}])(?:atau|or|dan|and|serta)(?![\p{L}])/u))
    .map((segment) =>
      segment
        .replace(/(?:rp\.?|idr)\s*[\d.,]+/g, " ")
        .split(/[^a-z0-9#+]+/)
        .filter((word) => word.length >= 2 && !STOP.has(word) && !drop.has(word) && !/\d/.test(word)),
    )
    .filter((words) => words.length > 0)
  const found = segments.flatMap((words) => splitKnown(words))
  const roles = found.filter((phrase) => phrase.split(" ").some((word) => ROLE_NOUNS.has(word)) || KNOWN_PHRASES.includes(phrase))
  const chosen = roles.length ? roles : found.filter((phrase) => phrase.split(" ").length <= 4)
  const asked = [...new Set(chosen)]
  const family = SIMILAR.test(lower) ? asked.flatMap((phrase) => FAMILY[phrase] ?? []) : []
  return unique([...asked, ...family])
}

/** The role as one text for display and older callers ("data analyst / business intelligence"). */
export function role(query: string, places: readonly string[]) {
  return phrases(query, places).join(" / ")
}

/** "tepat" when a title holds every word of one phrase, "mirip" when it shares a telling word, else undefined. */
export function matchLevel(title: string, wanted: readonly string[]) {
  if (wanted.length === 0) return "tepat" as const
  if (fits(title, wanted)) return "tepat" as const
  const telling = wanted.flatMap((phrase) => phrase.split(" ")).filter((word) => !GENERIC_ROLE.has(word))
  return telling.some((word) => titleHas(title, word)) ? ("mirip" as const) : undefined
}

/** True when the title holds every word of at least one phrase, as whole words ("bi" is not inside "Mobile"). */
export function fits(title: string, wanted: readonly string[]) {
  return wanted.some((phrase) => phrase.split(" ").every((word) => titleHas(title, word)))
}

/** The first phrase that a page text mentions with its words close together ("Data Analyst", "Analis Data"). */
export function phraseIn(text: string, wanted: readonly string[]) {
  const lower = text.toLowerCase()
  return wanted.find((phrase) => {
    const parts = phrase.split(" ").map((word) => `(?:${spellings(word).map(escape).join("|")})s?`)
    const gap = String.raw`(?:[^a-z0-9]+[a-z0-9]+){0,2}?[^a-z0-9]+`
    const forward = parts.join(gap)
    const backward = parts.toReversed().join(gap)
    return new RegExp(String.raw`(?<![a-z0-9])(?:${forward}|${backward})(?![a-z0-9])`).test(lower)
  })
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

/** Result pages per city from Jobstreet; one failed page never loses the others. */
export async function fetchJobstreet(input: { role: string; cities: readonly string[]; pages?: number }): Promise<Listing[]> {
  if (!ScrapeChromium.available() || !input.role) return []
  const seen = new Map<string, Listing>()
  for (const city of input.cities) {
    for (let page = 1; page <= (input.pages ?? 2); page++) {
      const url = `https://id.jobstreet.com/id/jobs?keywords=${encodeURIComponent(input.role)}&where=${encodeURIComponent(city)}${page > 1 ? `&page=${page}` : ""}`
      const rendered = await ScrapeChromium.render(url, { timeoutMs: 45_000, waitMs: 2500 }).catch(() => undefined)
      const found = rendered ? jobstreet(rendered.html) : []
      found.forEach((listing) => seen.set(listing.id, seen.get(listing.id) ?? listing))
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
          posted:
            card.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? (text(card.match(/<time[^>]*>(.*?)<\/time>/s)?.[1] ?? "") || undefined),
          url: `https://www.linkedin.com/jobs/view/${id}`,
          board: "linkedin",
        },
      ]
    })
}

/** Public result pages per city from LinkedIn. */
export async function fetchLinkedIn(input: { role: string; cities: readonly string[]; pages?: number }): Promise<Listing[]> {
  if (!ScrapeChromium.available() || !input.role) return []
  const seen = new Map<string, Listing>()
  for (const city of input.cities) {
    for (let page = 0; page < (input.pages ?? 2); page++) {
      const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(input.role)}&location=${encodeURIComponent(`${city}, Indonesia`)}&f_TPR=r2592000${page > 0 ? `&start=${page * 25}` : ""}`
      const rendered = await ScrapeChromium.render(url, { timeoutMs: 45_000, waitMs: 2500 }).catch(() => undefined)
      const found = rendered ? linkedin(rendered.html) : []
      found.forEach((listing) => seen.set(listing.id, seen.get(listing.id) ?? listing))
      if (found.length < 20) break
    }
  }
  return [...seen.values()]
}

/**
 * One row per job, the first one kept: the same board id or listing link, or the same title at the same company in the
 * same city on another board. The same title in two cities stays two rows.
 */
export function dedupe(listings: readonly Listing[]) {
  const seen = new Set<string>()
  return listings.filter((listing) => {
    // fork: "PT Metrodata Electronics Tbk" and "Metrodata Electronics" are one employer, and a board saying "Jakarta
    // Metropolitan Area" names no city, so it collapses with the same job's city row instead of becoming a duplicate.
    const company = (listing.company ?? "")
      .toLowerCase()
      .replace(/\b(pt|tbk|persero|cv|ltd|inc|corp|indonesia)\b/g, "")
      .replace(/[^a-z0-9]+/g, "")
    const title = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const city = /metropolitan|raya|area|indonesia$/i.test(listing.location ?? "")
      ? "any"
      : (placesIn(listing.location)[0] ?? (listing.location ?? "").toLowerCase().replace(/[^a-z]+/g, ""))
    // Karir.com cards all link the search page, so the link says nothing there.
    const sharedLink = listing.board === "karir" || /[?&](q|keyword|keywords)=/.test(listing.url)
    const keys = [
      `id|${listing.board}|${listing.id}`,
      ...(sharedLink ? [] : [`url|${listing.url.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "")}`]),
      ...(company ? [`job|${company}|${title}|${city}`] : []),
    ]
    if (company && city === "any" && [...seen].some((key) => key.startsWith(`job|${company}|${title}|`))) return false
    if (keys.some((key) => seen.has(key))) return false
    keys.forEach((key) => seen.add(key))
    return true
  })
}

/** A search hit that is the employer's own site: not a job board, social network, news site or document repository. */
export const isOfficialHost = (url: string) => {
  const host = hostOf(url)
  if (!host) return false
  const site = registrable(host)
  return (
    !NOT_OFFICIAL.some((domain) => host === domain || host.endsWith(`.${domain}`)) &&
    !AGGREGATOR_NAME.test(site.split(".")[0] ?? "") &&
    !host.split(".").some((label) => REPOSITORY_LABEL.test(label)) &&
    !/\.(ac\.id|sch\.id|edu|edu\.[a-z]{2})$/.test(host)
  )
}

/**
 * The employer named in a social or web post: "Dibutuhkan Data Analyst di PT Maju Jaya", "PT Maju Jaya is hiring",
 * "We're hiring at Traveloka", "Lowongan Kerja PT X", "Gojek sedang mencari …", an "@company" mention. Posts by job
 * aggregator accounts ("@lokerjakarta") and people's names are not employers; undefined when nothing names one.
 */
export function companyFromPost(text: string): string | undefined {
  const clean = text.replace(/[​ ]/g, " ").replace(/[ \t]+/g, " ")
  const legal = clean.match(/(?<![\p{L}])((?:PT|CV)\.?[ \t]+[\p{Lu}0-9][\p{L}0-9&.'’-]*(?:[ \t]+[\p{Lu}0-9(][\p{L}0-9&.'’()-]*){0,5})/u)?.[1]
  if (legal) {
    const words = legal.replace(/[\s.,(-]+$/, "").split(/\s+/)
    // "Tbk" / "Persero" end the name; a role word or a year after the name is the post, not the company.
    const legalEnd = words.findIndex((word, index) => index > 1 && /^(tbk|persero)\.?$/i.test(word))
    const stop = words.findIndex((word, index) => index > 1 && (POST_STOP.test(word) || ROLE_WORD.test(word)))
    // "PT X Data Analyst": the role's first word goes with it.
    const cutAt = legalEnd > 0 ? legalEnd + 1 : stop > 2 && ROLE_WORD.test(words[stop]!) && /^(data|business|bi|senior|junior|reporting|sr|jr)$/i.test(words[stop - 1]!) ? stop - 1 : stop
    const kept = (cutAt > 0 ? words.slice(0, cutAt) : words).join(" ").replace(/[\s.,(-]+$/, "").replace(/\s+(Tbk|Persero)\.?$/i, " $1")
    if (kept.split(/\s+/).length >= 2 && !aggregatorName(kept)) return kept.trim()
  }
  const named = (value: string | undefined) => {
    const name = value?.replace(/[\s.,!:;-]+$/, "").trim()
    return name && name.length >= 2 && !POST_STOP.test(name.split(/\s+/)[0]!) && !aggregatorName(name) ? name : undefined
  }
  const hiring = named(
    clean.match(/(?:^|[\n.!|•]\s*)([\p{Lu}][\p{L}0-9&.'’]*(?:\s[\p{Lu}0-9][\p{L}0-9&.'’]*){0,3})\s+(?:is\s+hiring|are\s+hiring|is\s+looking\s+for|sedang\s+mencari|membuka\s+lowongan|buka\s+lowongan|mencari\s+kandidat)\b/u)?.[1],
  )
  if (hiring) return hiring
  const at = named(
    clean.match(/\b(?:hiring|join(?:\s+us)?|bergabung(?:\s+bersama)?|bekerja|lowongan(?:\s+kerja)?|loker|dibutuhkan[^\n.]{0,60}?|karir|career)\s+(?:at|with|di|bersama|dengan)\s+([\p{Lu}][\p{L}0-9&.'’]*(?:\s[\p{Lu}0-9][\p{L}0-9&.'’]*){0,3})/u)?.[1],
  )
  if (at) return at
  const plainAt = named(clean.match(/\b(?:at|di)\s+([\p{Lu}][\p{L}0-9&.'’]+(?:\s+[\p{Lu}][\p{L}0-9&.'’]+){0,3})(?=\s*(?:[-|–—·,(]|$))/mu)?.[1])
  if (plainAt && !KNOWN_CITIES.includes(plainAt.toLowerCase()) && !/^(jakarta|tangerang|bekasi|depok|bogor|indonesia)\b/i.test(plainAt)) return plainAt
  const handle = [...clean.matchAll(/(?<![\w.])@([a-z0-9][a-z0-9._]{2,29})/gi)]
    .map((match) => match[1]!.replace(/[._]?(official|id|indonesia|careers?|karir|jobs|hr|recruitment)$/i, "").replace(/[._]+$/, ""))
    .find((name) => name.length >= 3 && !aggregatorName(name) && !/loker|lowongan|kerja|vacanc|hiring|info|job/i.test(name))
  return handle ? handle.replace(/[._]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : undefined
}

function aggregatorName(name: string) {
  const plain = name.toLowerCase().replace(/^(pt|cv)\.?\s+/, "").replace(/[^a-z0-9]+/g, "")
  return AGGREGATOR_NAME.test(plain) || /^(info|lowongan|loker|kerja|jobs?|vacancy|hiring|wearehiring)/.test(plain)
}

const ROLE_WORD = /^(analyst|analis|engineer|developer|staff|manager|officer|intern|internship|specialist|scientist|supervisor|executive|lead|head|\d{4})$/i
// Words after a company name in a post that are not part of it ("PT Maju Jaya Membuka Lowongan …").
const POST_STOP = /^(membuka|buka|mencari|sedang|is|are|hiring|lowongan|loker|untuk|posisi|bagian|dibutuhkan|segera|we|kami|di|at|sebagai|as|job|jobs|vacancy|urgent|requirements?|kualifikasi|penempatan|lokasi|gaji|via|melalui|dengan|yang|and|dan|for|–|—|-|\|)$/i

/**
 * True when a URL can be the company's own website: not a job board, aggregator, social network, news site, directory or
 * campus repository, and its registrable domain carries the company name ("bca.co.id", "klikbca.com" for BCA; never a
 * subdomain on someone else's site like "acme.business.site"). Short tokens (3 letters) must be a whole domain label.
 */
export function acceptWebsite(url: string, company: string) {
  if (!/^https?:\/\//i.test(url) || !isOfficialHost(url)) return false
  const site = registrable(hostOf(url))
  if (HOSTED.some((domain) => site === domain)) return false
  const labels = site.split(".").slice(0, -1).filter((label) => !/^(co|or|ac|go|web|my|biz|net|sch|com|org|gov|edu|mil|id)$/.test(label))
  const tokens = companyTokens(company)
  return labels.some((label) => {
    const plainLabel = label.replace(/[^a-z0-9]+/g, "")
    return tokens.some((token) => (token.length >= 4 ? plainLabel.includes(token) : plainLabel === token))
  })
}

/** Words of a company name that its own website carries: "PT Bank Central Asia Tbk" → ["bca", "bankcentralasia"]. */
export function companyTokens(company: string) {
  const words = MapsCompany.normalizeCompany(company).split(" ").filter(Boolean)
  const strong = words.filter((word) => word.length >= 3 && !GENERIC_COMPANY.has(word))
  const acronym = words.length >= 2 ? words.map((word) => word[0]).join("") : ""
  return [...new Set([...strong, ...(acronym.length >= 3 ? [acronym] : []), words.join("")])].filter((token) => token.length >= 3)
}

const plain = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()

export type Career = { company: string; url?: string; note: string; match: "yes" | "no" | "unknown" }

/**
 * Opens the employer's own career page and reports whether one of the role phrases shows up there. The page must be
 * the company's: the website OSM lists for it, or a search hit whose address or page title carries the company name
 * (never a job board, aggregator or campus repository). A home page is followed once to its careers link. Never
 * guesses: an unreadable page is reported as unreadable.
 */
export async function careerCheck(
  hits: readonly { url: string }[],
  input: { company: string; phrases: readonly string[]; website?: string },
): Promise<Career> {
  const unknown = (note: string, url?: string): Career => ({ company: input.company, ...(url ? { url } : {}), note, match: "unknown" })
  const tokens = companyTokens(input.company)
  const site = input.website ? registrable(hostOf(input.website)) : undefined
  const own = (url: string) => (site !== undefined && registrable(hostOf(url)) === site) || hostHasToken(url, tokens)
  const official = hits.filter((hit) => isOfficialHost(hit.url))
  const trusted = [...official.filter((hit) => own(hit.url)), ...(input.website ? [{ url: input.website }] : [])]
  const ranked = [...trusted.filter((hit) => careerLike(hit.url)), ...trusted.filter((hit) => !careerLike(hit.url))]
  // A hit without the name in its address is opened only when nothing better exists, and kept only if its title has it.
  const loose = official.filter((hit) => !own(hit.url))
  const pick = ranked[0] ?? loose.find((hit) => careerLike(hit.url)) ?? loose[0]
  if (!pick) return unknown("Situs resmi tidak ditemukan lewat pencarian")
  if (!ScrapeChromium.available()) return unknown("Browser tidak tersedia, halaman tidak dibuka", pick.url)
  // fork: OSM website tags and search hits are untrusted; private, loopback and metadata hosts are never opened.
  const open = async (url: string) => {
    const safe = await NetGuard.assertPublicUrl(url).then(() => true, () => false)
    if (!safe) return "private" as const
    const page = await ScrapeChromium.render(url, { timeoutMs: 35_000, waitMs: 3000 }).catch(() => undefined)
    if (!page) return undefined
    return (await NetGuard.assertPublicUrl(page.finalUrl).then(() => true, () => false)) ? page : ("private" as const)
  }
  const first = await open(pick.url)
  if (first === "private") return unknown("alamat privat ditolak", pick.url)
  if (!first) return unknown("Tidak bisa dibuka (timeout atau diblokir)", pick.url)
  if (!ranked.includes(pick) && !tokens.some((token) => first.title.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(token)))
    return unknown(`Situs resmi tidak terverifikasi: ${hostOf(pick.url)} tidak memuat nama perusahaan di alamat atau judulnya`)
  const link = careerLike(first.finalUrl) ? undefined : careerLink(first.html, first.finalUrl)
  const followed = link ? await open(link) : undefined
  const page = followed && followed !== "private" ? followed : first
  const body = plain(page.html)
  if (body.length < 200) return unknown("Halaman hampir kosong (daftar dimuat setelah login atau interaksi)", page.finalUrl)
  const found = phraseIn(body, input.phrases)
  if (found) {
    const at = body.toLowerCase().search(new RegExp(spellings(found.split(" ")[0]!).map(escape).join("|")))
    return {
      company: input.company,
      url: page.finalUrl,
      note: `Ada "${found}": …${body.slice(Math.max(0, at - 40), at + 80)}…`,
      match: "yes",
    }
  }
  const none = /0 jobs|no jobs|tidak ada lowongan|belum ada lowongan|no open positions|no current openings/i.test(body)
  return {
    company: input.company,
    url: page.finalUrl,
    note: none ? "Dibuka: halaman menyatakan tidak ada lowongan" : `Dibuka: tidak ada posisi ${input.phrases.join(" / ")} yang tampil`,
    match: "no",
  }
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
  intelligence: ["intelligence", "intelijen"],
}

/** True when the title contains the word or one of its spellings as a whole word (plural allowed). */
export function titleHas(title: string, word: string) {
  const lower = title.toLowerCase()
  return spellings(word).some((spelling) => new RegExp(`(?<![a-z0-9])${escape(spelling)}s?(?![a-z0-9])`).test(lower))
}

function spellings(word: string) {
  return SPELLINGS[word] ?? [word]
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function chain(place: string): string[] {
  const parent = PARENT[place]
  return parent ? [parent, ...chain(parent)] : []
}

/** Known role phrases inside a run of words, plus the rest when it names a role ("bi" alone is a BI analyst). */
function splitKnown(words: readonly string[]): string[] {
  const known = KNOWN_PHRASES.toSorted((a, b) => b.split(" ").length - a.split(" ").length)
  const marks = words.map(() => false)
  const found = words.flatMap((_, start) =>
    known.flatMap((phrase) => {
      const parts = phrase.split(" ")
      const match = parts.every((part, offset) => words[start + offset] === part && !marks[start + offset])
      if (!match) return []
      parts.forEach((__, offset) => (marks[start + offset] = true))
      return [{ start, phrase }]
    }),
  )
  const rest = words
    .map((word, index) => (marks[index] ? "|" : word))
    .join(" ")
    .split("|")
    .map((run) => run.trim())
    .filter(Boolean)
    .flatMap((run) => (run === "bi" ? ["bi analyst"] : found.length && !run.split(" ").some((word) => ROLE_NOUNS.has(word)) ? [] : [run.split(" ").slice(-4).join(" ")]))
  return [...found.toSorted((a, b) => a.start - b.start).map((item) => item.phrase), ...rest]
}

/** Phrases without repeats, "analis data" and "data analyst" counted once. */
function unique(list: readonly string[]) {
  const key = (phrase: string) =>
    phrase
      .split(" ")
      .map((word) => spellings(word)[0])
      .map((word) => (word === "analis" ? "analyst" : word))
      .toSorted()
      .join(" ")
  return list.filter((phrase, index) => list.findIndex((other) => key(other) === key(phrase)) === index)
}

function hostOf(url: string) {
  return URL.canParse(url) ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : ""
}

/** "karir.bca.co.id" → "bca.co.id", "id.jobstreet.com" → "jobstreet.com". */
function registrable(host: string) {
  const labels = host.split(".")
  const second = labels.at(-2) ?? ""
  const keep = labels.length >= 3 && /^(co|or|ac|go|web|my|biz|net|sch|com|org|gov|edu|mil)$/.test(second) ? 3 : 2
  return labels.slice(-keep).join(".")
}

function hostHasToken(url: string, tokens: readonly string[]) {
  const host = hostOf(url).replace(/[^a-z0-9]+/g, "")
  return tokens.some((token) => host.includes(token))
}

function careerLike(url: string) {
  return /karir|karier|career|jobs|job\b|recruit|lowongan|join|vacanc|hiring/i.test(url)
}

/** The careers link on a company home page, resolved against the page address. */
function careerLink(html: string, base: string) {
  const link = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)].find(
    (match) => careerLike(match[1] ?? "") || /karir|karier|career|lowongan|join us|bergabung|we.re hiring/i.test(text(match[2] ?? "")),
  )?.[1]
  if (!link || !URL.canParse(link, base)) return undefined
  const resolved = new URL(link, base).toString()
  return resolved.startsWith("http") ? resolved : undefined
}

const NOT_OFFICIAL = [
  "jobstreet.com", "jobstreet.co.id", "linkedin.com", "glints.com", "glints.id", "indeed.com", "kalibrr.com", "jobsdb.com", "karir.com",
  "jooble.org", "loker.id", "topkarir.com", "talenta.co", "dealls.com", "sejutacita.id", "kitalulus.com", "glassdoor.com", "glassdoor.co.id",
  "jobplanet.co.id", "qerja.com", "urbanhire.com", "kerjaholic.com", "jobs.id", "facebook.com", "instagram.com", "tiktok.com", "youtube.com",
  "wikipedia.org", "x.com", "twitter.com", "threads.net", "medium.com", "blogspot.com", "wordpress.com", "scribd.com", "slideshare.net",
  "academia.edu", "researchgate.net", "suratplus.com", "crunchbase.com", "zoominfo.com", "dnb.com", "bloomberg.com", "kompas.com",
  "detik.com", "tribunnews.com", "liputan6.com", "kumparan.com", "idntimes.com", "cnbcindonesia.com", "cnnindonesia.com", "bisnis.com",
  "kontan.co.id", "tempo.co", "antaranews.com", "okezone.com", "sindonews.com", "merdeka.com", "kompasiana.com", "brainly.co.id",
  "pinterest.com", "reddit.com", "quora.com", "google.com", "maps.google.com", "goo.gl", "bit.ly", "linktr.ee",
]
// Free site builders: a company page there is not proof of its own domain.
const HOSTED = ["business.site", "wixsite.com", "github.io", "netlify.app", "vercel.app", "webflow.io", "carrd.co", "weebly.com", "site123.me", "godaddysites.com", "mystrikingly.com"]
// Job aggregators under many domains ("lokerjakarta.id", "lowongankerja15.com", "infoloker.net").
const AGGREGATOR_NAME = /^(loker|lowongan|infoloker|infolowongan|karir|kerja|jobs?|vacanc|career|portalkerja|bursakerja)/
const REPOSITORY_LABEL = /^(eprints?|repository|repositori|repo|digilib|ejournal|e-journal|journal|jurnal|perpustakaan|library|lib|skripsi|thesis)$/
const GENERIC_COMPANY = new Set(
  "bank asuransi koperasi yayasan global digital teknologi technology tech solusi solution solutions mitra sinar mega prima central asia international internasional nusantara jaya abadi sejahtera makmur sentosa utama karya bersama media data sistem system systems consulting konsultan services service industri industries trading logistik logistics capital finance financial investama properti property indo persada perkasa".split(
    " ",
  ),
)
