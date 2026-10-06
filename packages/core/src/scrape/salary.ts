export * as Salary from "./salary.js"

// fork: job boards print salaries as text ("Rp 5.500.000 – 7.500.000", "Rp.4 – 5 Juta", "IDR 11000000 - 15000000 /
// MONTH", "Rp 150 juta/tahun"). A salary floor ("di atas 11 juta") needs them as numbers; a listing without a salary
// is not below the floor, it is unknown.

export type Period = "month" | "year" | "week" | "day" | "hour" | "unknown"

export type Parsed = {
  readonly min?: number
  readonly max?: number
  readonly period: Period
  /**
   * Per month; a yearly salary is divided by 12, weekly x4.33, daily x22 working days, hourly x173; an unknown period is
   * taken as monthly (how Indonesian boards print).
   */
  readonly monthlyMin?: number
  readonly monthlyMax?: number
}

/** Rupiah amounts in a salary text, or undefined when it holds none (or names another currency). */
export function parse(text: string | undefined): Parsed | undefined {
  if (!text) return undefined
  const lower = text.toLowerCase().replace(/\s+/g, " ")
  const rupiah = /\b(rp|idr|rupiah)\b|rp\.?\s*\d/.test(lower)
  if (!rupiah && /\$|\b(usd|sgd|eur|myr|aud|gbp|jpy)\b/.test(lower)) return undefined
  const found = [...lower.matchAll(NUMBER)].map((match) => ({
    digits: match[1]!,
    unit: match[2],
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
  // "Rp.4 – 5 Juta", "Rp 15 – Rp 20 juta": a bare number before a range dash takes the unit of the number after it.
  const values = found.flatMap((item, index) => {
    const next = found[index + 1]
    const between = next ? lower.slice(item.end, next.index) : ""
    const unit = item.unit ?? (next?.unit && RANGE.test(between) ? next.unit : undefined)
    const value = amount(item.digits, unit)
    return value >= 10_000 ? [{ value, index: item.index, end: item.end }] : []
  })
  if (!values.length) return undefined
  const first = values[0]!
  const second = values[1]
  const ranged = second !== undefined && RANGE.test(lower.slice(first.end, second.index))
  const upTo = /\b(up to|hingga|sampai|maks(imal|imum)?|max|s\/d|sd)\b\s*(rp\.?|idr)?\s*$/.test(lower.slice(0, first.index))
  const from = /\b(mulai|from|min(imal|imum)?|di ?atas|above|starting|start)\b\s*(rp\.?|idr)?\s*$/.test(
    lower.slice(0, first.index),
  )
  const low = ranged ? Math.min(first.value, second!.value) : upTo ? undefined : first.value
  const high = ranged ? Math.max(first.value, second!.value) : from ? undefined : first.value
  const period: Period = YEAR.test(lower)
    ? "year"
    : MONTH.test(lower)
      ? "month"
      : WEEK.test(lower)
        ? "week"
        : DAY.test(lower)
          ? "day"
          : HOUR.test(lower)
            ? "hour"
            : "unknown"
  const monthly = (value: number | undefined) =>
    value === undefined ? undefined : Math.round(value * PER_MONTH[period])
  return {
    ...(low !== undefined ? { min: low, monthlyMin: monthly(low) } : {}),
    ...(high !== undefined ? { max: high, monthlyMax: monthly(high) } : {}),
    period,
  }
}

/**
 * Whether a listing can pay at least `minMonthly` rupiah a month: "yes" when its top of range reaches it, "no" when the
 * disclosed salary stays below it, "unknown" when no salary is disclosed.
 */
export function meets(text: string | undefined, minMonthly: number): "yes" | "no" | "unknown" {
  const parsed = parse(text)
  const top = parsed?.monthlyMax ?? parsed?.monthlyMin
  if (top === undefined) return "unknown"
  return top >= minMonthly ? "yes" : "no"
}

/** "11" + "juta" → 11 000 000; "5.500.000" → 5 500 000; "4,5" + "jt" → 4 500 000. */
export function amount(digits: string, unit?: string) {
  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(digits)
  const value = grouped ? Number(digits.replace(/[.,]/g, "")) : Number(digits.replace(",", "."))
  return Math.round(value * multiplier(unit))
}

/** "Rp 11 jt" → "Rp 11 jt" (11 000 000 → "11 jt") for table cells. */
export function short(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1)).toLocaleString("id-ID")} jt`
  return value.toLocaleString("id-ID")
}

function multiplier(unit: string | undefined) {
  if (!unit) return 1
  if (/^(miliar|milyar|billion|bn)$/.test(unit)) return 1_000_000_000
  if (/^(juta|jt|jta|jtan|mio|million|m)$/.test(unit)) return 1_000_000
  if (/^(ribu|rb|k)$/.test(unit)) return 1_000
  return 1
}

// A number with its unit; "m"/"k" only count as units when no letter follows ("8m", not "8 month").
const NUMBER =
  /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(miliar|milyar|billion|juta|jtan|jta|jt|million|mio|ribu|rb|bn|m|k)?(?![a-z])/g
const RANGE = /^\s*(?:,-|,00|\.-)?\s*(-|–|—|~|to|s\/d|sd|sampai|hingga|until)\s*(rp\.?|idr)?\s*$/
const YEAR = /(\/|per|setiap|tiap)\s*(tahun|thn|th|year|yr|annum)\b|\b(annual(ly)?|yearly|tahunan|p\.a\.?)(?![a-z])/
const MONTH = /(\/|per|setiap|tiap)\s*(bulan|bln|bl|month|mo|mth)\b|\b(monthly|bulanan)\b/
const WEEK = /(\/|per|setiap|tiap)\s*(minggu|pekan|week|wk)\b|\b(weekly|mingguan)\b/
const DAY = /(\/|per|setiap|tiap)\s*(hari|day)\b|\b(daily|harian)\b/
const HOUR = /(\/|per|setiap|tiap)\s*(jam|hour|hr)\b|\b(hourly)\b/
const PER_MONTH: Record<Period, number> = { year: 1 / 12, month: 1, unknown: 1, week: 4.33, day: 22, hour: 173 }
