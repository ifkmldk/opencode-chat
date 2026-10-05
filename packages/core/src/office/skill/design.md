# Document design: how to make Office files that look made by a designer

Read this before any .docx, .pptx, .xlsx or PDF you will hand to a person. The format skills (pptx, docx, xlsx, pdf) hold the recipes; this holds the taste and the process.

## The process (not optional)

1. **Understand the job.** Who reads it, where (projector, print, phone, inbox), what they must decide or do after. Write one sentence: "After this, the reader will ___." Everything on a page must serve that sentence.
2. **Get the real content first.** Real numbers, real names, real quotes. If you lack data, ask or say what is a placeholder. Never invent figures and present them as fact.
3. **Choose a look on purpose** (see below), say which one in one line, then build with the office kit (`office_kit` returns the import lines).
4. **Render and look.** Call `office_render` on the file and read every page image. Fix and render again until a page passes the checklist. Do not tell the user it is done before you have looked.
5. **Deliver** the file path plus two lines: what it contains and anything you assumed.

## Choosing a look

Pick palette + font pair from the subject, not from habit. The kit has these (pass the names to `createDeck/createReport/createWorkbook`):

| Palette | Feels like | Good for |
| --- | --- | --- |
| `editorial` | warm paper, rust and teal | strategy, essays, culture, hospitality, research |
| `graphite` | white, ink, one blue | product, engineering, SaaS, data |
| `midnight` | deep navy, amber | keynotes, launches, finance on screen |
| `sage` | soft green, clay | sustainability, health, education, food |
| `ledger` | black, white, signal red | finance, legal, audit, newspapers, workbooks |
| `plum` | cream, plum, brass | luxury, arts, events, brands |

Fonts: `editorial` (Georgia + Calibri), `classic` (Cambria + Calibri), `modern` (Segoe UI), `clean` (Calibri Light), `bold` (Bahnschrift + Segoe UI). Only use fonts that ship with Windows/Office, or the page will fall back and shift.

If the user gives brand colors or a logo, use them: override with your own hex values and keep the same layout rules. If they attach a template (.pptx/.docx/.xlsx), open it, study its layouts and fonts, and build inside it instead of the kit.

## Rules that separate designed from generated

- **One idea per slide / one job per page.** The title states the conclusion ("Margin fell 2.1 points on freight"), not the topic ("Margin analysis").
- **One accent color.** Neutrals do the work; the accent marks the single thing to look at. A second accent only for comparison in charts.
- **Left-align text.** Centered paragraphs, centered bullets and justified text with rivers all look generated. Centering is for one short line (a cover, a big number).
- **Type scale, not sizes.** Title 28-40, lead 15-18, body 11-14, caption 9-10 (pt). Body text on slides never below 12pt. Two weights per family at most.
- **Space is a feature.** Margins at least 0.75in on slides, 2cm on A4. Leave a third of the page empty on purpose. Crowding is the most common failure.
- **Real structure.** Slide: grid with shared left edge. Document: real Heading 1/2/3 styles (so navigation and a table of contents work), real list numbering, real table header rows. Never fake structure with spaces, tabs or manual numbers.
- **Data wants the right form.** A comparison is a bar chart with a one-sentence takeaway beside it; a trend is a line; parts of a whole is 3-5 slices at most; exact values are a table. Label directly, drop gridlines you do not need, no 3-D, no rainbow.
- **Tables are quiet.** Header in small caps muted, one rule under it, hairlines between rows, numbers right-aligned in a consistent format. No heavy borders or full-grid cell outlines.
- **Images earn their place.** Use the user's photos, or real charts and diagrams you drew from real data. Do not paste stock-looking art, and do not add decorative icons next to every bullet.

## Anti-slop list (if you did any of these, redo it)

- Purple-to-blue gradients, glassy cards, drop shadows on everything.
- A row of three identical rounded cards with an icon, a bold title and two lines of text.
- Emoji or clip-art icons as bullets or headings.
- Centered title + subtitle + bullets on every slide; every slide the same layout.
- Filler: "In today's fast-paced world", "leverage", "unlock", "seamless", slides that restate the title.
- Walls of bullets (more than 5 per slide, more than 12 words each). Make it a chart, a table, a number, or split it.
- Title in a different font size or position on each page; margins that drift.
- Fake precision (digits you do not have) and made-up statistics or testimonials.
- Default Office blue/orange series colors left unstyled.

## The render checklist (look at every image)

- Any text cut off, overflowing its box, overlapping another element, or wrapping to a lone word (widow)?
- Contrast: can you read every line at arm's length? Gray on tinted background is the usual failure.
- Alignment: do titles and body share one left edge across pages? Equal margins?
- Is the first thing your eye lands on the thing that matters most?
- Tables: nothing clipped at the right edge, header repeats, numbers aligned.
- Charts: labels readable, legend not covering data, colors distinguishable in grayscale.
- Document: no heading stranded at the bottom of a page, no page with one orphan line, page numbers present.
- Language and numbers: the same unit, currency and date format everywhere, spelling correct.

When a page fails, change the source (shorter text, smaller block, split the page), never shrink body text below the minimum to make it fit.
