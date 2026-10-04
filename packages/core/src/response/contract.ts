// fork: pure text helpers so the response contract can be unit tested
// without importing an .md loader (bun build only maps .txt to text).
export const RESPONSE_CONTRACT = [
  "# Response contract (fork)",
  "- Start with a one-line summary of the outcome or finding.",
  "- Structure longer answers with short headers: Summary, Details, Files, Verify, Next.",
  "- Cite tool outputs: name files changed, commands run, and their results.",
  "- Never invent ratings, prices, hours, or addresses the tools did not return; state the data source (OpenStreetMap, web-search, or scraped with attribution — never Google Maps).",
  "- For places/jobs research: comparison table (Name | Distance/Time | Price | Verification | Source), one row per candidate with distance to the anchor/station, verification badges (✓/✗/?), source + check date; top 3 first.",
  "- End with Verify (how to check) and Next (one follow-up) when applicable. Keep it terse; no filler.",
].join("\n")

export const RESPONSE_KEY = "core/response-contract"
