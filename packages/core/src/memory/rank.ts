export * as MemoryRank from "./rank.js"

// fork: relevance ranking for remembered notes. The old search was `LIKE %whole sentence%` ordered by recency, which almost
// never matched a natural question and, when it did, returned whatever was newest. Recall that injects the wrong note is worse
// than none (answers go "out of context"), so this is deliberately strict: at least two distinct query words must match
// (or one title word for a one- or two-word query), notes written as preferences and corrections weigh more, and imported junk is dropped.

export type Rankable = {
  readonly id: string
  readonly kind: string
  readonly scope: string
  readonly title: string
  readonly body: string
  readonly source?: string
}

const STOP = new Set(
  (
    "the and for are but not you your with this that from have has had was were will would can could should about into over under than then them they their there here what when where which who how why " +
    "yang dan atau untuk dari dengan pada dalam ini itu aku saya kamu anda kita kami mereka bisa akan sudah belum tidak bukan apa siapa kapan dimana mana bagaimana kenapa mengapa ada adalah juga lebih paling sangat sama cari carikan tolong mohon dong deh nih lah kah"
  ).split(" "),
)

const KIND_WEIGHT: Record<string, number> = { preference: 1.5, correction: 1.5, fact: 1.1, person: 1.1, "project-brief": 1, decision: 0.7 }

export const tokens = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3 && !STOP.has(word)))]

/** Machine-made notes that only repeat a file path or a few words are noise, not memory. */
export const isNoise = (entry: Rankable) =>
  entry.body.trim().length < 30 || (/^(Keputusan|Fakta|Decision|Fact):/i.test(entry.title) && /[\\/]/.test(entry.title) && entry.body.trim().length < 80)

export function score(query: string, entry: Rankable) {
  const words = tokens(query)
  if (words.length === 0) return 0
  const title = entry.title.toLowerCase()
  const body = entry.body.toLowerCase()
  let hits = 0
  let strongTitle = false
  let total = 0
  for (const word of words) {
    if (title.includes(word)) {
      total += 3
      hits += 1
      strongTitle = true
    } else if (body.includes(word)) {
      total += 1
      hits += 1
    }
  }
  // Two distinct words must match; a single title hit counts only for a very short query.
  if (hits < 2 && !(strongTitle && words.length <= 2)) return 0
  const coverage = hits / words.length
  return total * (0.5 + coverage) * (KIND_WEIGHT[entry.kind] ?? 1)
}

export function rank<T extends Rankable>(query: string, entries: readonly T[], options: { limit?: number; minScore?: number } = {}) {
  const seen = new Set<string>()
  return entries
    .filter((entry) => !isNoise(entry))
    .filter((entry) => {
      const key = `${entry.title}\n${entry.body}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((entry) => ({ entry, score: score(query, entry) }))
    .filter((item) => item.score >= (options.minScore ?? 3))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5)
    .map((item) => item.entry)
}

/** The block injected before the user's message; empty when nothing relevant. */
export function block(entries: readonly Rankable[], maxChars = 1200) {
  const lines: string[] = []
  let used = 0
  for (const entry of entries) {
    const line = `- [${entry.kind}] ${entry.title}: ${entry.body.replace(/\s+/g, " ").slice(0, 280)}`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) return ""
  return [
    "<memory>",
    "Notes the user saved earlier that may be relevant. Use one only if it clearly fits the current question; they can be outdated, and what the user says now wins. Do not mention this block.",
    ...lines,
    "</memory>",
  ].join("\n")
}
