# Word documents (.docx)

Read the `design` skill first. Build documents with the office kit (docx library underneath), then `office_render` and look at every page.

## Setup

Call `office_kit` once per session, write a script (e.g. `build-report.mjs`), run it with `node`.

```js
import { createReport } from "file:///{{KIT}}/report.mjs"

const report = createReport({ title: "Market entry plan", palette: "editorial", fonts: "editorial", footer: "Acme · Confidential", author: "Strategy team" })
report.cover({ kicker: "STRATEGY", title: "Market entry plan", subtitle: "Indonesia, 2027", meta: "Prepared for the board" })
report.h1("Summary").lead("Three findings decide whether we enter in 2027.")
report.p("Demand is concentrated in Jakarta and Surabaya...")
report.h2("Findings").bullets(["Addressable market of IDR 4.2 trillion", ["Entry cost: ", { text: "IDR 85 billion", bold: true }]])
report.numbered(["Sign a distribution partner", "Hire a country lead"])
report.callout("Entry is attractive only if freight stays under 9% of revenue.", "Risk")
report.table({ header: ["Item", "Cost (IDR bn)", "Timing"], rows: [["Warehouse", "32", "Q1"]], widths: [4, 2, 2], align: ["left", "right", "left"] })
report.quote("Speed matters less than getting the first ten customers right.", "Country lead, interview")
await report.save("out/plan.docx")
```

Helpers (all chainable): `cover, h1, h2, h3, p, lead, bullets (level 0-2), numbered (level 0-2), callout, table, quote, image(file,{width,caption}), pagebreak, save`. Text can be a string or an array of strings / `{ text, bold, italics, color }`.

Styles are real Word styles (Heading 1-3, list numbering, header with title, footer with page number), so the Navigation pane works and the user can restyle everything from Word.

## Document types and shape

- **Report / proposal:** cover, summary (the answer in under a page), numbered sections, tables for figures, an appendix. Open with what the reader should decide.
- **Letter / memo:** no cover; a short header block (to, from, date, subject), the point in the first two sentences, one ask at the end.
- **CV:** one page, one column of content, name large, section labels in small caps, dates right-aligned. Use the `docx` library directly with a tab stop for the date column; no tables for layout, no photos unless asked, no skill bars.
- **Contract / policy:** numbered clauses (`numbered` levels 0-2 give 1., 1.1, 1.1.1 style), defined terms in bold at first use, page numbers.
- **Brochure / flyer:** this is a layout job. Build HTML and print it to PDF (see the `pdf` skill) unless the user needs an editable .docx.

## Writing rules

Short paragraphs (3-5 lines). Lead with the point. Numbers carry units and a period ("IDR 4.2 trillion, 2026"). Prefer a table to a paragraph that lists figures. Prefer a callout to bold text for the one warning or recommendation. No headings that only restate the one above them.

## Going beyond the helpers

For anything the helpers do not cover (footnotes, table of contents field, columns, landscape sections) copy the pattern in `report.mjs` (it is in the kit folder, next to `node_modules/docx`) into your own script saved inside the kit folder, or run your script with the kit folder as working directory so `import ... from "docx"` resolves.

## Editing an existing .docx

Keep the author's styles. Use python-docx (`pip install python-docx`) or unzip and edit `word/document.xml`. Change only what was asked, save to a new file, `office_render` it, and compare with the original. For tracked changes or comments, say so and edit the XML (`w:ins`, `w:del`, `comments.xml`).

## Failure list

Heading stranded at the bottom of a page; a table running past the margin; manual numbering typed as text; two spaces for indentation; mixed fonts (copy-paste residue); tiny gray text on tinted fills; a cover with five lines in five sizes; page numbers missing; blank last page.
