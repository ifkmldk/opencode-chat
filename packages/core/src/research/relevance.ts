export * as JobRelevance from "./relevance.js"

import { JobBoards } from "../scrape/jobboards.js"

// fork: "data analyst atau sejenisnya" let any title sharing a word through as "Mirip": network engineers, data center
// operators, reporting accountants. For data-analyst searches each title is now scored against phrase lists: the asked
// phrases and core titles are Tepat, adjacent analyst titles are Mirip, known unrelated jobs are dropped, and an
// ambiguous title is Mirip only when the listing's own text is data-heavy (SQL, Python, Tableau, Power BI, …).

export type Decision =
  | { readonly level: "tepat" | "mirip"; readonly label?: string }
  | { readonly drop: "role" | "unrelated" | "borderline"; readonly label: string }

type Rule = { readonly label: string; readonly pattern: RegExp; readonly unlessData?: boolean }

const word = (source: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${source})(?![\p{L}\p{N}])`, "iu")

const ANALYST = String.raw`(?:analysts?|analis|analytics?)`

const CORE: readonly Rule[] = [
  { label: "data analyst", pattern: word(String.raw`data\s+${ANALYST}|analis\s+data|data\s+analytics`) },
]

const ADJACENT: readonly Rule[] = [
  { label: "reporting analyst", pattern: word(String.raw`report(?:ing)?\s+${ANALYST}`) },
  { label: "business analyst", pattern: word(String.raw`business\s+${ANALYST}|analis\s+bisnis`) },
  { label: "merchandise analyst", pattern: word(String.raw`merchandis(?:e|ing)\s+(?:${ANALYST}|planner|planning)`) },
  { label: "business intelligence", pattern: word(String.raw`business\s+intelligence|bi\s+(?:${ANALYST}|developer|engineer|specialist|consultant|lead)|bi`) },
  { label: "data intelligence", pattern: word(String.raw`data\s+intelligence|market\s+intelligence`) },
  { label: "insight analyst", pattern: word(String.raw`insights?(?:\s+&\s+|\s+and\s+|\s+)?(?:${ANALYST}|specialist|manager|lead)|consumer\s+insights?`) },
  { label: "analytics", pattern: word(String.raw`analytics\s+(?:specialist|manager|lead|engineer|consultant|associate|officer|staff)|(?:web|digital|marketing|product|people|hr|growth|crm|customer)\s+analytics`) },
  {
    label: "domain analyst",
    pattern: word(
      String.raw`(?:product|marketing|sales|commercial|pricing|revenue|supply\s+chain|demand|inventory|financial\s+planning|fp&a|financial|finance|planning|operations?|risk|credit\s+risk|growth|crm|performance|research|quantitative|customer)\s+${ANALYST}`,
    ),
  },
  { label: "demand planner", pattern: word(String.raw`demand\s+planner|fp&a|financial\s+planning(?:\s+&\s+analysis)?`) },
  { label: "MIS", pattern: word(String.raw`mis|management\s+information(?:\s+systems?)?`) },
  { label: "data management", pattern: word(String.raw`data\s+(?:management|governance|quality|steward|specialist|officer|staff|science)|master\s+data`) },
  { label: "data scientist / engineer", pattern: word(String.raw`data\s+(?:scientists?|engineers?)|analytics\s+engineer|machine\s+learning\s+engineer`) },
]

const UNRELATED: readonly Rule[] = [
  { label: "network engineer", pattern: word(String.raw`network\s+(?:engineer|administrator|admin|specialist|support)|jaringan`) },
  { label: "system administrator", pattern: word(String.raw`(?:system|systems|sys|server|it)\s*admin(?:istrator)?|sysadmin|it\s+infra(?:structure)?|infrastructure|it\s+support|helpdesk|help\s+desk`) },
  { label: "data center operator", pattern: word(String.raw`data\s*cent(?:er|re)|site\s+operations?|noc`) },
  { label: "accounting", pattern: word(String.raw`accounting|accountant|akuntan|akuntansi|tax|pajak|bookkeep(?:er|ing)|finance\s+(?:staff|admin|officer)|account\s+payable|account\s+receivable|ap\/ar`) },
  { label: "data entry", pattern: word(String.raw`data\s+entry|entri\s+data|input\s+data|data\s+input|typist`) },
  { label: "admin", pattern: word(String.raw`admin|administrasi|administrative|administration|secretary|sekretaris|clerk`) },
  { label: "cyber security", pattern: word(String.raw`cyber|security|keamanan|soc|penetration|pentest`) },
  { label: "HR / talent acquisition", pattern: word(String.raw`talent\s+acquisition|recruit(?:er|ment|ing)?|hrd?|human\s+(?:resources?|capital)|people\s+(?:partner|operations)|payroll`), unlessData: true },
  { label: "customer service", pattern: word(String.raw`customer\s+(?:service|care|support|experience\s+officer)|call\s+cent(?:er|re)|cs`) },
  { label: "sales", pattern: word(String.raw`sales|account\s+executive|telemarketing|marketing\s+executive|business\s+development|relationship\s+(?:manager|officer)|business\s+relation`) },
]

// A title with one of these words may be a data job; the listing text decides.
const AMBIGUOUS = word(String.raw`${ANALYST}|data|report(?:ing)?|laporan|insights?|intelligence|dashboard|statisti(?:k|cs?|cian)|planner|kpi|bi`)

const SIGNALS: readonly [string, RegExp][] = [
  ["SQL", word(String.raw`sql|mysql|postgres(?:ql)?|bigquery`)],
  ["Python", word(String.raw`python|pandas|r\s+programming`)],
  ["Tableau", word("tableau")],
  ["Power BI", word(String.raw`power\s*bi|looker|metabase|qlik|data\s+studio`)],
  ["dashboard", word("dashboards?")],
  ["KPI", word(String.raw`kpis?|metrics`)],
  ["visualisasi data", word(String.raw`data\s+visuali[sz]ation|visualisasi\s+data|visuali[sz]ation`)],
  ["Excel lanjutan", word(String.raw`(?:advanced|advance|mahir)\s+(?:ms\.?\s+)?excel|excel\s+(?:lanjut(?:an)?|advanced|mahir)|vlookup|pivot(?:\s+table)?`)],
  ["reporting", word(String.raw`reporting|laporan|reports?`)],
  ["statistik", word(String.raw`statisti(?:k|cs|cal)|analisis\s+data|data\s+analysis|analyz(?:e|ing)\s+data|mengolah\s+data|olah\s+data`)],
]

const DATA_PHRASES = /(?<![a-z])(data|analis|analyst|analytics|business intelligence|bi|reporting)(?![a-z])/

/** True when every asked phrase is a data/analytics role, so the data-analyst lists apply. */
export function isDataFamily(phrases: readonly string[]) {
  return phrases.length > 0 && phrases.every((phrase) => DATA_PHRASES.test(phrase.toLowerCase()))
}

/** The distinct data-skill signals a listing text mentions. */
export function dataSignals(text: string | undefined) {
  if (!text) return []
  return SIGNALS.filter((entry) => entry[1].test(text)).map((entry) => entry[0])
}

/**
 * Tepat, Mirip, or why the listing is dropped. Outside data-analyst searches this is the plain phrase match
 * (JobBoards.matchLevel, or the asked words anywhere in a web hit's text).
 */
export function classify(listing: { readonly title: string; readonly summary?: string }, phrases: readonly string[], web = false): Decision {
  if (!isDataFamily(phrases)) {
    const level = web
      ? JobBoards.fits(`${listing.title} ${listing.summary ?? ""}`, phrases)
        ? ("tepat" as const)
        : undefined
      : JobBoards.matchLevel(listing.title, phrases)
    return level ? { level } : { drop: "role", label: "posisi lain" }
  }
  const title = listing.title
  if (JobBoards.fits(title, phrases)) return { level: "tepat" }
  const core = CORE.find((rule) => rule.pattern.test(title))
  if (core) return { level: "tepat", label: core.label }
  const strong = dataSignals(listing.summary).length >= 2
  const unrelated = UNRELATED.find((rule) => rule.label !== "sales" && rule.pattern.test(title))
  if (unrelated) return unrelated.unlessData && strong ? { level: "mirip", label: unrelated.label } : { drop: "unrelated", label: unrelated.label }
  const adjacent = ADJACENT.find((rule) => rule.pattern.test(title))
  if (adjacent) return { level: "mirip", label: adjacent.label }
  const sales = UNRELATED.find((rule) => rule.label === "sales" && rule.pattern.test(title))
  if (sales) return { drop: "unrelated", label: sales.label }
  // A web hit's title is a page title; its text is the posting, so the asked words there still make it a match.
  if (web && JobBoards.fits(`${title} ${listing.summary ?? ""}`, phrases)) return { level: "tepat", label: "teks postingan" }
  if (AMBIGUOUS.test(title)) return strong ? { level: "mirip", label: "JD data" } : { drop: "borderline", label: "judul ambigu tanpa JD data" }
  return { drop: "role", label: "posisi lain" }
}
