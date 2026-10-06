import { describe, expect, test } from "bun:test"
import { extractConstraints, linesOf, mustNegated, mustPattern } from "../src/research/constraints.js"

const KRL = ["bogor", "cikarang", "rangkasbitung", "tangerang", "tanjung-priok"]
const OWNER =
  "Carikan perusahaan yang buka loker data analyst atau sejenisnya posisi yg relevan dengan gaji di atas 11 juta. lokasi perusahaannya wajib radius <1km dari KRL, boleh dari line rangkas bitung atau yg line lain. yg jelas dari stasiun KRL tsb bisa jalan kaki hemat ongkos."

describe("research constraints from the audited sessions", () => {
  test("a city name is not a train line: hotel in BSD Tangerang keeps BSD as the anchor", () => {
    const c = extractConstraints("hotel termurah lokasi di bsd tangerang rating bagus")
    expect(c.transit).toBeUndefined()
    expect(c.transitLine).toBeUndefined()
    expect(c.anchor?.toLowerCase()).toContain("bsd")
    expect(c.anchor?.toLowerCase()).not.toContain("rating")
    expect(c.kind).toBe("hotel")
    expect(c.radiusExplicit).toBe(false)
  })

  test("a hospital near Stasiun Serpong anchors on the station and asks for hospitals", () => {
    const c = extractConstraints("rumah sakit terdekat dari stasiun serpong")
    expect(c.station?.name).toBe("Serpong")
    expect(c.anchor).toBe("Stasiun Serpong")
    expect(c.transit?.stations.map((station) => station.name)).toEqual(["Serpong"])
    expect(c.kind).toBe("hospital")
  })

  test("the owner's KRL prompt: every KRL line, 1 km, salary floor 11 juta, no bogus anchor", () => {
    const c = extractConstraints(OWNER)
    expect([...(c.transit?.lines ?? [])].toSorted()).toEqual([...KRL].toSorted())
    expect(c.transit?.lines).toContain("rangkasbitung")
    expect(c.radiusKm).toBe(1)
    expect(c.radiusExplicit).toBe(true)
    expect(c.minSalary).toBe(11_000_000)
    expect(c.travelMode).toBe("walking")
    expect(c.anchor).toBeUndefined()
  })

  test("the anchor is the hotel itself, not the BSD area", () => {
    const c = extractConstraints("tempat wisata dekat Pranaya Boutique Hotel BSD")
    expect(c.anchor).toBe("Pranaya Boutique Hotel BSD")
    expect(c.anchorKind).toBe("near")
    expect(c.kind).toBe("attraction")
    expect(c.transit).toBeUndefined()
  })

  test("'dari stasiun sudirman' is the KRL station, not Jl. Sudirman", () => {
    const c = extractConstraints("loker data analyst yang bisa jalan kaki dari stasiun sudirman")
    expect(c.station?.name).toBe("Sudirman")
    expect(c.station?.mode).toBe("krl")
    expect(c.anchor).toBe("Stasiun Sudirman")
    expect(c.radiusKm).toBe(1)
  })

  test("one line named next to a rail word", () => {
    const c = extractConstraints("cari kerja data analyst sekitar KRL rangkasbitung bisa jalan dari stasiun", "")
    expect(c.transit?.lines).toEqual(["rangkasbitung"])
    expect(c.transitLine).toBe("KRL Rangkasbitung")
    expect(c.radiusKm).toBe(1)
    expect(c.travelMode).toBe("walking")
  })

  test("bare city words never set a line", () => {
    for (const text of ["hotel murah di Bogor", "kantor di Bekasi", "loker Tangerang Selatan", "kos di Serpong"])
      expect(extractConstraints(text).transit).toBeUndefined()
  })
})

describe("radius, anchors and salary floors", () => {
  test("radius forms", () => {
    expect(extractConstraints("kantor radius 2km dari Monas").radiusKm).toBe(2)
    expect(extractConstraints("kos 500 m dari kampus").radiusKm).toBe(0.5)
    expect(extractConstraints("data analyst dekat stasiun KRL <1km").radiusKm).toBe(1)
    expect(extractConstraints("kantor 5 menit jalan kaki dari stasiun Tanah Abang").radiusKm).toBeCloseTo(0.4)
    expect(extractConstraints("hotel dekat Monas").radiusKm).toBe(3)
  })

  test("anchors stop at punctuation and connectors", () => {
    expect(extractConstraints("kos 2 km dari Monas, ada AC").anchor).toBe("Monas")
    expect(extractConstraints("cafe sekitar Blok M yang buka 24 jam").anchor).toBe("Blok M")
    expect(extractConstraints("restaurant near Grand Indonesia with parking").anchor).toBe("Grand Indonesia")
    expect(extractConstraints("data analyst dekat stasiun KRL radius 1km").anchor).toBeUndefined()
  })

  test("salary floors", () => {
    expect(extractConstraints("loker di atas 11 juta").minSalary).toBe(11_000_000)
    expect(extractConstraints("loker >11jt").minSalary).toBe(11_000_000)
    expect(extractConstraints("minimal 11 juta").minSalary).toBe(11_000_000)
    expect(extractConstraints("minimal 2 tahun pengalaman, gaji 11jt+").minSalary).toBe(11_000_000)
    expect(extractConstraints("radius <1km dari KRL").minSalary).toBeUndefined()
  })

  test("transitLine text: KRL alone or 'semua jalur' is every line, a named line is that line", () => {
    expect([...linesOf("KRL")].toSorted()).toEqual([...KRL].toSorted())
    expect([...linesOf("semua jalur")].toSorted()).toEqual([...KRL].toSorted())
    expect(linesOf("KRL Rangkasbitung")).toEqual(["rangkasbitung"])
    expect(linesOf("bogor")).toEqual(["bogor"])
  })
})

describe("must-haves match whole words", () => {
  test("ac is not inside contact or place; furnished is not unfurnished", () => {
    expect(mustPattern("ac").test("Kamar ber-AC, wifi")).toBe(true)
    expect(mustPattern("ac").test("contact person, nice place")).toBe(false)
    expect(mustPattern("furnished").test("full furnished")).toBe(true)
    expect(mustPattern("furnished").test("unfurnished unit")).toBe(false)
    expect(extractConstraints("kontrakan unfurnished, contact pemilik").must).toEqual([])
    expect(extractConstraints("kontrakan ada carport dan AC").must.toSorted()).toEqual(["ac", "carport"])
  })

  test("negations are recognised", () => {
    expect(mustNegated("ac").test("kamar non-AC")).toBe(true)
    expect(mustNegated("ac").test("tanpa AC")).toBe(true)
    expect(mustNegated("furnished").test("unfurnished")).toBe(true)
    expect(mustNegated("ac").test("Kamar ber-AC")).toBe(false)
  })
})
