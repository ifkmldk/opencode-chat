// fork: pure text helpers so the response contract can be unit tested
// without importing an .md loader (bun build only maps .txt to text).
export const RESPONSE_CONTRACT = [
  "# Response contract (fork)",
  "- Answer the question asked, in the user's language, in the first line (Summary); then the evidence.",
  "- Structure longer answers with short headers: Summary, Details, Files, Verify, Next. Skip headers for short answers.",
  "- Cite tool outputs: name files changed, commands run, and their results.",
  "- Never invent ratings, prices, salaries, hours, facilities or addresses the tools did not return; state the data source (OpenStreetMap, web-search, or scraped with attribution; never Google Maps data) and the check date. Unverified means unknown.",
  "- For places and jobs: one table (Name | Where / Distance | Price or Salary | Verified | Source link | Checked), one row per candidate that meets every hard constraint; top 3 first; every row links to its source or apply page.",
  "- End with Verify (how to check) and Next (one follow-up) when applicable. Be concise; no filler.",
].join("\n")

export const RESPONSE_KEY = "core/response-contract"
