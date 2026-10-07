export * as ScrapeExtract from "./extract.js"

// fork: turn a fetched page into what the question needs. Careers and company pages are mostly menus, cookie banners and
// footers; the model got that noise (or an empty shell) and answered from memory. Pure functions, tested.

const NOISE = /<(script|style|noscript|svg|template|iframe|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi
const TAGS = /<[^>]+>/g
const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }

export const textOf = (html: string) =>
  html
    .replace(NOISE, " ")
    .replace(TAGS, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim()

/** Largest <main> / <article> / role=main block, or undefined. */
function mainBlock(html: string) {
  const blocks = [...html.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi), ...html.matchAll(/<(div|section)\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/gi)]
  return blocks.map((match) => match[0]).sort((a, b) => textOf(b).length - textOf(a).length)[0]
}

/** Main content of a page as HTML: the main block when it carries real text, else the page without chrome. */
export function mainContent(html: string) {
  const full = textOf(html).length
  const main = mainBlock(html)
  if (main && textOf(main).length >= Math.max(300, full * 0.4)) return main
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  const stripped = body.replace(NOISE, " ")
  // Never return less than a stub: if stripping removed (nearly) everything, the page keeps its own structure.
  const kept = textOf(stripped).length
  return kept >= 80 || (kept > 0 && kept >= full) ? stripped : html
}

export type JobPosting = {
  title: string
  company?: string
  location?: string
  /** Street address of the first jobLocation that has one (street, locality, region, postal code). */
  address?: string
  latitude?: number
  longitude?: number
  posted?: string
  expires?: string
  salary?: string
  url?: string
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined)

function place(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (!first || typeof first !== "object") return asString(first)
  const address = (first as Record<string, unknown>).address
  if (address && typeof address === "object") {
    const record = address as Record<string, unknown>
    return [record.streetAddress, record.addressLocality, record.addressRegion, record.addressCountry].map(asString).filter(Boolean).join(", ") || undefined
  }
  return asString(address)
}

/** The office street address and geo coordinates of the first jobLocation, when the posting gives them. */
function office(value: unknown): { address?: string; latitude?: number; longitude?: number } {
  const first = Array.isArray(value) ? value[0] : value
  if (!first || typeof first !== "object") return {}
  const record = first as Record<string, unknown>
  const address = record.address && typeof record.address === "object" ? (record.address as Record<string, unknown>) : undefined
  const street = address ? asString(address.streetAddress) : undefined
  const geo = record.geo && typeof record.geo === "object" ? (record.geo as Record<string, unknown>) : undefined
  const latitude = Number(geo?.latitude)
  const longitude = Number(geo?.longitude)
  const located = !!geo && Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)
  const parts = address ? [street, address.addressLocality, address.addressRegion, address.postalCode] : []
  return {
    ...(street ? { address: parts.map((item) => asString(typeof item === "number" ? String(item) : item)).filter(Boolean).join(", ") } : {}),
    ...(located ? { latitude, longitude } : {}),
  }
}

function salary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const amount = record.value && typeof record.value === "object" ? (record.value as Record<string, unknown>) : undefined
  const parts = [amount?.minValue, amount?.maxValue ?? amount?.value].filter((item) => item !== undefined)
  return parts.length ? `${asString(record.currency) ?? ""} ${parts.join(" - ")}${amount?.unitText ? ` / ${String(amount.unitText)}` : ""}`.trim() : undefined
}

/** schema.org JobPosting entries from JSON-LD, including ones inside @graph or arrays. */
export function jobPostings(html: string): JobPosting[] {
  const found: JobPosting[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    const type = record["@type"]
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
      const org = record.hiringOrganization
      const title = asString(record.title)
      if (title)
        found.push({
          title,
          company: org && typeof org === "object" ? asString((org as Record<string, unknown>).name) : asString(org),
          location: place(record.jobLocation),
          ...office(record.jobLocation),
          posted: asString(record.datePosted),
          expires: asString(record.validThrough),
          salary: salary(record.baseSalary),
          url: asString(record.url) ?? asString(record.sameAs),
        })
    }
    visit(record["@graph"])
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!.trim()))
    } catch {
      // malformed JSON-LD is common; skip the block
    }
  }
  return found
}

const HEADER = "## Structured job postings (JSON-LD)"

/** One labelled line per posting: "- **Data Analyst** · company: PT A · address: … · geo: -6.2,106.8 · url: …". */
export function jobPostingsMarkdown(postings: readonly JobPosting[]) {
  if (postings.length === 0) return ""
  return [
    HEADER,
    ...postings.map((job) =>
      [
        `- **${job.title.replace(/\*\*|·/g, " ").trim()}**`,
        ...LABELS.flatMap((label) => {
          const value = label.read(job)
          return value ? [`${label.name}: ${value.replace(/·/g, ",")}`] : []
        }),
      ].join(" · "),
    ),
  ].join("\n")
}

/** The postings jobPostingsMarkdown wrote, read back from scraped page text (the scrape tiers return text, not HTML). */
export function postingsFromText(text: string): JobPosting[] {
  const at = text.indexOf(HEADER)
  if (at < 0) return []
  return text
    .slice(at + HEADER.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- **"))
    .flatMap((line) => {
      const parts = line.slice(2).split(" · ")
      const title = parts[0]?.match(/^\*\*(.+)\*\*$/)?.[1]?.trim()
      if (!title) return []
      const fields = new Map(
        parts.slice(1).flatMap((part) => {
          const index = part.indexOf(": ")
          return index > 0 ? [[part.slice(0, index), part.slice(index + 2).trim()] as const] : []
        }),
      )
      const geo = (fields.get("geo") ?? "").split(",").map(Number)
      const posting: JobPosting = {
        title,
        ...Object.fromEntries(
          LABELS.filter((label) => label.key !== "geo" && fields.get(label.name)).map((label) => [label.key, fields.get(label.name)]),
        ),
        ...(geo.length === 2 && geo.every(Number.isFinite) ? { latitude: geo[0]!, longitude: geo[1]! } : {}),
      }
      return [posting]
    })
}

const LABELS: readonly {
  name: string
  key: Exclude<keyof JobPosting, "title" | "latitude" | "longitude"> | "geo"
  read: (job: JobPosting) => string | undefined
}[] = [
  { name: "company", key: "company", read: (job) => job.company },
  { name: "location", key: "location", read: (job) => job.location },
  { name: "address", key: "address", read: (job) => job.address },
  {
    name: "geo",
    key: "geo",
    read: (job) => (job.latitude !== undefined && job.longitude !== undefined ? `${job.latitude},${job.longitude}` : undefined),
  },
  { name: "salary", key: "salary", read: (job) => job.salary },
  { name: "posted", key: "posted", read: (job) => job.posted },
  { name: "until", key: "expires", read: (job) => job.expires },
  { name: "url", key: "url", read: (job) => job.url },
]

const CHALLENGE = /just a moment|attention required|enable javascript|access denied|verify you are (a )?human|captcha|checking your browser|unusual traffic|are you a robot|your connection is not private|err_cert|this site can.t be reached|err_name_not_resolved/i

/** True when the text is a real page, not an empty shell, menu stub or bot wall. */
export function isUseful(text: string) {
  const trimmed = text.trim()
  if (trimmed.length < 200) return false
  return !(trimmed.length < 1500 && CHALLENGE.test(trimmed))
}
