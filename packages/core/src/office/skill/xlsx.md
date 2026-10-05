# Excel workbooks (.xlsx)

Read the `design` skill first. A spreadsheet is read by scanning: make the structure obvious, keep inputs apart from calculations, and let formulas calculate. Then `office_render` and look.

## Setup

Call `office_kit` once, write `build-book.mjs`, run it with `node`.

```js
import { createWorkbook } from "file:///{{KIT}}/sheet.mjs"

const book = createWorkbook({ palette: "ledger", fonts: "clean", title: "Sales 2026" })
book.table("Sales", {
  title: "Sales by region", subtitle: "Net of returns, IDR",
  columns: [
    { header: "Region", key: "region", width: 22 },
    { header: "Revenue", key: "revenue", format: "idr", width: 20 },
    { header: "Margin", key: "margin", format: "pct" },
  ],
  rows: [{ region: "Jakarta", revenue: 1250000000, margin: 0.31 }],
  totals: { label: "Total", sum: ["revenue"] },
})
book.notes("About", ["How to read this workbook", "Revenue is net of returns.", "Source: finance ledger, 2026-09-30."])
await book.save("out/sales.xlsx")
```

`table` options: `title, subtitle, columns[{header,key,width,format,align}], rows (objects or arrays), totals{label,sum[],average[]}, freeze, filter, banding`. It returns the exceljs worksheet, so you can add anything else (`sheet.getCell("D2").value = { formula: "B2*C2" }`).

Named formats: `int, decimal, usd, idr, eur, pct, date, datetime, text`; any other string is passed to Excel as a number format.

## Rules

- **Formulas, not pasted results.** Derived cells are formulas (`{ formula: "SUM(B2:B9)" }`, totals via `totals`). Never hard-code a number a formula could produce. Keep assumptions in their own labelled cells and reference them.
- **Each sheet has a job** and a title in A1. Header row frozen, filter on, widths set so nothing shows `####`. Numbers right-aligned with one format per column; dates real dates, not text.
- **No merged cells inside data** (they break sorting). No color-coding without a legend. Gridlines off on presentation sheets (the kit does this).
- Order: summary or dashboard first if the reader is a manager; raw data last.

## Charts and conditional formatting

exceljs cannot create charts. Two routes:
1. Put the chart in a deck or report (the kit's `deck.chart` is native and editable) and keep the workbook for the numbers.
2. Native Excel chart: write the workbook with Python openpyxl (`pip install openpyxl`): `BarChart`/`LineChart`, `Reference`, `ws.add_chart(chart, "E2")`; conditional formatting with `openpyxl.formatting.rule` (`ColorScaleRule`, `CellIsRule`, `DataBarRule`). Take series colors from the palette hex values.

## Reading and cleaning an existing workbook

Use pandas (`pd.read_excel(path, sheet_name=None)`) for analysis, openpyxl or exceljs to preserve formatting when you must edit. When you edit, change only the targeted cells, keep formats and formulas, save to a new file, re-open it and spot-check values. Formulas written by libraries have no cached values until Excel opens the file; `office_render` (through Excel) recalculates, so a render is also your formula check.

## Rendering note

Without a printer installed Windows blocks Excel's PDF export; `office_render` then prints each sheet through Excel's HTML export and a Chromium browser. Layout of fonts, fills, borders and number formats is Excel's own; page breaks are not.

## Failure list

`####` columns; numbers stored as text; a total that excludes the last row; dates as strings; every column the same width; merged title cells over data; red/green only encoding; hundreds of rows with no frozen header; a chart with 12 series.
