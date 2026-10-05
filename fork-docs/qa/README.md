# Document QA renders

Produced with the office kit and `office_render` (PowerPoint, Word, Excel via COM; HTML via Chromium) on 2026-10-05, version 2.0.22-fork.3.

| File | What |
| --- | --- |
| 1-deck-01/04/05 | Pitch deck (midnight + bold): cover, line chart with takeaway, two-column comparison |
| 2-proposal-02 | Proposal (sage + classic): summary, callout, table, numbered list, pull quote |
| 3-report-02 | Report (graphite + modern): bullets, table, recommendations |
| 4-workbook-01 | Budget workbook (ledger + clean): title block, banded rows, totals as formulas |
| 5-cv-01 | One-page CV via `createCV` |
| 6-brochure-01/02 | Two-page brochure written as HTML and printed with Chromium |

Regenerate: write the scripts as in the skills, then call `office_render` on each file and compare.
