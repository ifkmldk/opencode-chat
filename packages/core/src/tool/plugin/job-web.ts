export * as JobWeb from "./job-web.js"

import { Effect } from "effect"
import type { WebSearch } from "../../websearch.js"

/**
 * fork: job lookups through plain web search. The old code always sent "lowongan <query>", so a query that already said
 * "lowongan data analyst Bandung" became "lowongan lowongan ..." and some providers answered with nothing; a provider error
 * was also swallowed, so an outage looked like "no jobs". Now: one phrasing without the doubled word, then two broader
 * phrasings, and the first provider error is returned when nothing was found.
 */
export const queries = (query: string) => {
  const base = query.replace(/^\s*(lowongan|loker)\s+/i, "").trim()
  return [`lowongan ${base}`, `${base} jobstreet glints kalibrr`, `${base} linkedin`]
}

export const search = (run: (query: string) => Effect.Effect<WebSearch.Response, WebSearch.Error>, query: string) =>
  Effect.gen(function* () {
    const failures: string[] = []
    for (const phrasing of queries(query)) {
      const found = yield* run(phrasing).pipe(Effect.result)
      if (found._tag === "Success" && found.success.results.length > 0) return { results: found.success.results, error: undefined }
      if (found._tag === "Failure") failures.push((found.failure as Error)?.message ?? String(found.failure))
    }
    return { results: [] as WebSearch.Response["results"], error: failures.at(0) }
  })
