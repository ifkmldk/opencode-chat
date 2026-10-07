# PowerPoint decks (.pptx)

Read the `design` skill first. Build decks with code using the office kit (pptxgenjs underneath), then `office_render` and look at every slide.

## Setup

Call `office_kit` once per session: it installs the kit if needed and prints the import lines. Then write a script anywhere (e.g. `build-deck.mjs`) and run it with `node`.

```js
import { createDeck } from "file:///{{KIT}}/deck.mjs"

const deck = createDeck({ title: "Q3 review", palette: "editorial", fonts: "editorial", footer: "Acme · Q3 2026", author: "Finance" })
deck.cover({ kicker: "QUARTERLY REVIEW", title: "Growth held, margin did not", subtitle: "Q3 2026 · Finance", meta: "Board of directors" })
deck.content({ title: "What changed", bullets: ["Revenue +12% on enterprise renewals", "Gross margin down 2.1 points"], aside: "Margin is the only metric off plan." })
deck.stats({ title: "The quarter in three numbers", items: [{ value: "+12%", label: "Revenue year over year" }, { value: "61.4%", label: "Gross margin" }, { value: "1.8%", label: "Monthly churn" }] })
deck.chart({ title: "Revenue by segment (IDR bn)", type: "bar",
  data: [{ name: "Q2", labels: ["Enterprise", "SMB", "Retail"], values: [42, 28, 19] }, { name: "Q3", labels: ["Enterprise", "SMB", "Retail"], values: [51, 29, 18] }],
  takeaway: "Enterprise carried the quarter. Retail slipped as promotions ended." })
await deck.save("out/q3.pptx")
```

Run: `node build-deck.mjs`. The imports are absolute, so the script can live in the user's project.

## Slide types (each returns the pptxgenjs slide, so you can add to it)

| Helper | Use for | Fields |
| --- | --- | --- |
| `cover` | first slide | `kicker, title, subtitle, meta` |
| `section` | chapter divider | `number, title, caption` |
| `content` | a point with 2-5 short bullets | `title, bullets[], paragraph, aside, notes` |
| `statement` | one sentence that matters | `text, source` |
| `bigNumber` | one number as the message | `title, value, label, caption` |
| `stats` | 2-4 numbers side by side | `title, items[{value,label}]` |
| `twoColumn` | compare / before-after | `title, left{heading,bullets,text}, right{...}` |
| `imageText` | photo + argument | `title, text, bullets, image (path), side` |
| `step` | one step of a user guide (screenshot shown whole) | `number, title, image (path), actions[], tip` |
| `table` | exact figures (max ~7 rows) | `title, rows[][] (first row = header), widths[], note` |
| `chart` | trend, comparison, share | `title, type bar/line/pie/doughnut/area, data, takeaway` |
| `quote` | one voice | `text, by` |
| `timeline` | 3-6 steps | `title, steps[{label,text}]` |
| `closing` | ask / next steps | `title, lines[]` |

Chart `data` is pptxgenjs shape: `[{ name, labels[], values[] }]`, one object per series.

## Structure of a good deck

- 1 cover, then the answer first (the recommendation or the headline number), then the evidence, then the ask. Not "agenda, background, details".
- Titles are sentences that state the conclusion. A reader skimming only titles should get the argument.
- Vary the layout with the content: do not use `content` for everything. Numbers become `stats` or `bigNumber`, comparisons become `twoColumn` or `chart`, a turning point becomes `statement`.
- 8-14 slides for a talk; fewer for a pitch. Put speaker notes in `notes` when the user will present.
- Text per slide: at most 5 bullets, at most 12 words per bullet. Move detail to notes or an appendix.

## Going beyond the helpers

Each helper returns its slide, so you can add your own shapes, images (`addImage`), or full-bleed photos with the pptxgenjs API. Use the palette via `import { palette } from "file:///{{KIT}}/design.mjs"`. Keep a 0.75in margin and the 12-column grid (13.333 x 7.5in slides).

Images: use files the user gave you or images you generate from real data (e.g. a map screenshot, a chart). Crop with `sizing: { type: "cover", w, h }`. Never stretch.

## Editing an existing deck

Load it with python-pptx (or unzip and edit the XML), change text in place, keep the original layouts and fonts, save to a new file, then `office_render` and compare with the original. Never rebuild a branded deck from scratch with the kit.

## Failure list

Text overflow in a fixed box (shorten the text, do not shrink below 12pt); title on 3 lines; chart legend over the bars; table taller than the slide; low-contrast gray caption on a tinted card; slides where every element is centered; the default Office palette showing through in charts (the kit sets colors, keep them).
