import { describe, expect, test } from "bun:test"
import { JobRelevance } from "../src/research/relevance"

const PHRASES = ["data analyst", "business intelligence", "bi analyst", "reporting analyst"]
const level = (title: string, summary?: string) => {
  const decision = JobRelevance.classify({ title, ...(summary ? { summary } : {}) }, PHRASES)
  return "drop" in decision ? `drop:${decision.drop}:${decision.label}` : decision.level
}

describe("data-analyst relevance", () => {
  test("asked phrases and core titles are Tepat", () => {
    expect(level("Data Analyst")).toBe("tepat")
    expect(level("Senior Business Intelligence Analyst")).toBe("tepat")
    expect(level("Analis Data")).toBe("tepat")
    expect(level("Data Analytics Lead")).toBe("tepat")
  })

  test("related analyst titles are Mirip", () => {
    for (const title of [
      "Business Analyst",
      "Merchandise Analyst",
      "Merchandising Analyst",
      "BI Developer",
      "Data Intelligence Specialist",
      "Insight Analyst",
      "Product Analyst",
      "Marketing Analyst",
      "Sales Analyst",
      "Commercial Analyst",
      "Pricing Analyst",
      "Supply Chain Analyst",
      "Financial Planning Analyst",
      "MIS Officer",
      "Management Information System Staff",
      "Data Management Specialist",
      "Data Scientist",
      "Data Engineer",
    ])
      expect([title, level(title)]).toEqual([title, "mirip"])
  })

  test("unrelated titles from the last KRL answer are dropped with their reason", () => {
    expect(level("IT Infra (Network Engineer, System Administrator, Data Center Operator dll)")).toBe("drop:unrelated:network engineer")
    expect(level("Data Center Site Operation (Specialist/Lead/Manager)")).toBe("drop:unrelated:data center operator")
    expect(level("Accounting and Reporting_Cikarang")).toBe("drop:unrelated:accounting")
    expect(level("Reporting Accountant")).toBe("drop:unrelated:accounting")
    expect(level("Business Relation Head (Data-Driven)")).toBe("drop:unrelated:sales")
    expect(level("Admin Data Entry")).toBe("drop:unrelated:data entry")
    expect(level("Cyber Security Analyst")).toBe("drop:unrelated:cyber security")
    expect(level("Customer Service Officer")).toBe("drop:unrelated:customer service")
    expect(level("Sales Executive")).toBe("drop:unrelated:sales")
    expect(level("System Administrator")).toBe("drop:unrelated:system administrator")
  })

  test("HR analysts count only with a data-heavy description", () => {
    expect(level("Talent Acquisition Analyst")).toBe("drop:unrelated:HR / talent acquisition")
    expect(level("HR Analyst", "Membuat dashboard Power BI, query SQL, laporan KPI bulanan")).toBe("mirip")
  })

  test("an ambiguous title is promoted by the listing text, otherwise dropped as borderline", () => {
    expect(level("Reporting")).toBe("drop:borderline:judul ambigu tanpa JD data")
    expect(level("Reporting", "Menguasai SQL, Excel advanced (VLOOKUP, pivot) dan Tableau")).toBe("mirip")
    expect(level("Strategy Planner", "Python, dashboard, KPI")).toBe("mirip")
    expect(level("Graphic Designer")).toBe("drop:role:posisi lain")
  })

  test("other searches keep the plain phrase match", () => {
    expect(JobRelevance.isDataFamily(["software engineer"])).toBe(false)
    expect(JobRelevance.classify({ title: "Senior Software Engineer" }, ["software engineer"])).toEqual({ level: "tepat" })
    expect(JobRelevance.classify({ title: "Network Engineer" }, ["software engineer"])).toEqual({ drop: "role", label: "posisi lain" })
  })

  test("data signals are counted once each", () => {
    expect(JobRelevance.dataSignals("SQL, MySQL, Python dan Power BI; dashboard KPI")).toEqual(["SQL", "Python", "Power BI", "dashboard", "KPI"])
    expect(JobRelevance.dataSignals(undefined)).toEqual([])
  })
})
