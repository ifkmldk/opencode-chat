import { describe, expect, test } from "bun:test"
import { Salary } from "../src/scrape/salary.js"

describe("Salary.parse", () => {
  test("board formats", () => {
    expect(Salary.parse("Rp 5.500.000 – 7.500.000")).toMatchObject({ min: 5_500_000, max: 7_500_000, period: "unknown", monthlyMax: 7_500_000 })
    expect(Salary.parse("Rp.4 – 5 Juta")).toMatchObject({ min: 4_000_000, max: 5_000_000 })
    expect(Salary.parse("IDR 11000000 - 15000000 / MONTH")).toMatchObject({ min: 11_000_000, max: 15_000_000, period: "month" })
    expect(Salary.parse("Rp 6 juta - Rp 8 juta/bulan")).toMatchObject({ min: 6_000_000, max: 8_000_000, period: "month" })
    expect(Salary.parse("Rp 7.000.000 per month")).toMatchObject({ min: 7_000_000, max: 7_000_000, period: "month" })
    expect(Salary.parse("Rp 15 – Rp 20 juta per month")).toMatchObject({ min: 15_000_000, max: 20_000_000 })
    expect(Salary.parse("Rp 4.500.000,00 - Rp 5.000.000,00")).toMatchObject({ min: 4_500_000, max: 5_000_000 })
  })

  test("short forms and yearly salaries", () => {
    expect(Salary.parse("11jt")).toMatchObject({ min: 11_000_000, max: 11_000_000 })
    expect(Salary.parse("11 juta")).toMatchObject({ min: 11_000_000 })
    expect(Salary.parse("Rp 150 juta/tahun")).toMatchObject({ min: 150_000_000, period: "year", monthlyMin: 12_500_000, monthlyMax: 12_500_000 })
    expect(Salary.parse("up to Rp 10.000.000")).toMatchObject({ max: 10_000_000 })
    expect(Salary.parse("up to Rp 10.000.000")?.min).toBeUndefined()
  })

  test("no amount, another currency or no salary at all", () => {
    expect(Salary.parse(undefined)).toBeUndefined()
    expect(Salary.parse("Competitive")).toBeUndefined()
    expect(Salary.parse("2 hari yang lalu")).toBeUndefined()
    expect(Salary.parse("$1,000 - $2,000")).toBeUndefined()
  })
})

describe("Salary.meets", () => {
  test("a disclosed maximum below the floor fails; no salary is unknown, never a failure", () => {
    expect(Salary.meets("Rp 5.500.000 – 7.500.000", 11_000_000)).toBe("no")
    expect(Salary.meets("Rp 8 juta - Rp 12 juta", 11_000_000)).toBe("yes")
    expect(Salary.meets("Rp 150 juta/tahun", 11_000_000)).toBe("yes")
    expect(Salary.meets(undefined, 11_000_000)).toBe("unknown")
    expect(Salary.meets("Negotiable", 11_000_000)).toBe("unknown")
  })
})

describe("Salary periods shorter than a month", () => {
  test("daily, weekly and hourly pay is converted to a month before the floor is compared", () => {
    expect(Salary.parse("Rp 120.000/hari")).toMatchObject({ period: "day", monthlyMax: 2_640_000 })
    expect(Salary.parse("Rp 50.000 per jam")?.period).toBe("hour")
    expect(Salary.parse("Rp 3 juta / minggu")).toMatchObject({ period: "week", monthlyMax: 12_990_000 })
    expect(Salary.meets("Rp 120.000/hari", 11_000_000)).toBe("no")
    expect(Salary.meets("Rp 600.000 per hari", 11_000_000)).toBe("yes")
  })
})
