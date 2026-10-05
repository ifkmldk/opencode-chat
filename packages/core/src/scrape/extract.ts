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

export type JobPosting = { title: string; company?: string; location?: string; posted?: string; expires?: string; salary?: string; url?: string }

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

export function jobPostingsMarkdown(postings: readonly JobPosting[]) {
  if (postings.length === 0) return ""
  return [
    "## Structured job postings (JSON-LD)",
    ...postings.map((job) =>
      `- **${job.title}**${job.company ? ` · ${job.company}` : ""}${job.location ? ` · ${job.location}` : ""}${job.salary ? ` · ${job.salary}` : ""}${job.posted ? ` · posted ${job.posted}` : ""}${job.expires ? ` · until ${job.expires}` : ""}${job.url ? ` · ${job.url}` : ""}`,
    ),
  ].join("\n")
}

const CHALLENGE = /just a moment|attention required|enable javascript|access denied|verify you are (a )?human|captcha|checking your browser|unusual traffic|are you a robot|your connection is not private|err_cert|this site can.t be reached|err_name_not_resolved/i

/** True when the text is a real page, not an empty shell, menu stub or bot wall. */
export function isUseful(text: string) {
  const trimmed = text.trim()
  if (trimmed.length < 200) return false
  return !(trimmed.length < 1500 && CHALLENGE.test(trimmed))
}
