# PDF files

Read the `design` skill first. Three jobs: read a PDF, make a new one, change an existing one.

## Reading

- Text PDFs: `read` the file directly, or extract text with MuPDF (installed with the kit; run the script from the kit folder): `import * as mupdf from "mupdf"; const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf"); doc.loadPage(0).toStructuredText().asText()`.
- To SEE a page (layout, charts, scans): `office_render` with `file` = the PDF and `pages: "3"` returns the page image.
- Scans with no text layer: render the page and read it visually; for long scans use an OCR tool if one is available.
- Tables: extract text with positions, or render and read; verify totals by adding them up.

## Making a new PDF

Best route for designed output (brochures, one-pagers, invoices, certificates, reports with custom layout): **write HTML + CSS and print it with Chromium**. You get full typographic control (CSS grid, `@page` size and margins, installed fonts, SVG charts).

1. Write `doc.html` with `@page { size: A4; margin: 18mm }`, a type scale, a 12-column grid, and print rules (`break-inside: avoid` on figures and table rows, `break-after: avoid` on headings).
2. `office_render` accepts `.html` and returns the page images and the PDF path (reported in the tool result). Look at the pages, fix, render again, then copy the PDF to where the user wants it.
3. For charts use inline SVG you generate from the data. No CDN scripts: printing happens offline and scripts may not finish.

If the user also needs it editable in Word, build a .docx (see the `docx` skill) and render it instead; Word exports a faithful PDF.

## Changing an existing PDF

- Merge, split, rotate, reorder, stamp page numbers or watermarks: `pdf-lib` (installed with the kit; run the script from the kit folder). The kit also has `merge-pdf.mjs <out.pdf> <a.pdf> <b.pdf>`.
- Fill form fields: pdf-lib `form.getTextField(name).setText(...)`.
- Editing body text in place is unreliable. Prefer regenerating the page from its source, or overlay new text with pdf-lib on a white box and tell the user you did.

## Failure list

Fonts substituted (use installed fonts); text cut at the page edge; images at 72 dpi; a table row split across pages; links not clickable; a 40 MB PDF because of full-size photos (resize first).
