import { describe, expect, test } from "bun:test"
import { MapsCategory } from "../src/maps/categories.js"
import { MapsOsm } from "../src/maps/osm.js"

describe("place categories", () => {
  test.each([
    ["rumah sakit dekat stasiun tanah abang", "hospital"],
    ["RS Siloam", "hospital"],
    ["RSUD Tangerang Selatan", "hospital"],
    ["hospital", "hospital"],
    ["klinik 24 jam", "clinic"],
    ["puskesmas", "clinic"],
    ["tempat wisata sekitar BSD", "attraction"],
    ["objek wisata", "attraction"],
    ["destinasi wisata", "attraction"],
    ["tourist attraction", "attraction"],
    ["taman hiburan", "attraction"],
    ["museum", "attraction"],
    ["taman kota", "park"],
    ["hotel murah", "hotel"],
    ["penginapan", "hotel"],
    ["losmen", "hotel"],
    ["homestay", "hotel"],
    ["guest house", "hotel"],
    ["kantor", "office"],
    ["perusahaan", "office"],
    ["Kantor Pertamina", "office"],
    ["mal", "mall"],
    ["restoran", "restaurant"],
    ["kedai kopi", "cafe"],
    ["coworking space", "coworking"],
    ["SPBU", "gas_station"],
    ["apotek", "pharmacy"],
    ["masjid", "mosque"],
    ["halte busway", "bus_stop"],
    ["stasiun", "station"],
  ])("%s is %s", (text, kind) => {
    expect(MapsCategory.fromText(text)).toBe(kind as MapsCategory.Kind)
  })

  test("names, addresses and words that only contain a category are not categories", () => {
    expect(MapsCategory.fromText("Menara Astra")).toBeUndefined()
    expect(MapsCategory.fromText("Traveloka")).toBeUndefined()
    expect(MapsCategory.fromText("Jl. Pahlawan Seribu")).toBeUndefined()
    expect(MapsCategory.fromText("Mrs Kitchen")).toBeUndefined()
    expect(MapsCategory.fromText("transport")).toBeUndefined()
  })

  test("parse separates the category, the name words and the place", () => {
    expect(MapsCategory.parse("hotel murah dekat Stasiun Serpong")).toEqual({
      kind: "hotel",
      name: "",
      place: "Stasiun Serpong",
      head: "hotel murah",
    })
    expect(MapsCategory.parse("RS Siloam di Kebon Jeruk")).toMatchObject({
      kind: "hospital",
      name: "siloam",
      place: "Kebon Jeruk",
    })
    expect(MapsCategory.parse("tempat wisata di sekitar BSD?")).toMatchObject({
      kind: "attraction",
      name: "",
      place: "BSD",
    })
    expect(MapsCategory.parse("hotels near AEON Mall BSD City")).toMatchObject({
      kind: "hotel",
      place: "AEON Mall BSD City",
    })
    expect(MapsCategory.parse("AEON Mall BSD City")).toMatchObject({ kind: "mall", name: "aeon bsd city" })
    expect(MapsCategory.parse("dekat stasiun serpong ada rumah sakit")).toMatchObject({ kind: "hospital" })
    expect(MapsCategory.parse("Menara Astra")).toEqual({
      kind: undefined,
      name: "menara astra",
      place: undefined,
      head: "Menara Astra",
    })
  })

  test("every category maps to valid Overpass selectors", () => {
    MapsCategory.KINDS.forEach((kind) =>
      MapsCategory.tags(kind).forEach((tag) => expect(MapsOsm.filter(tag), `${kind}: ${tag}`).toBeDefined()),
    )
    expect(MapsCategory.tags("hospital")).toEqual(["amenity=hospital", "healthcare=hospital"])
    expect(MapsCategory.tags("hotel")).toEqual(["tourism=hotel|guest_house|hostel|motel|apartment"])
    expect(MapsCategory.tags("office")).toEqual(["office", "building=office|commercial|company"])
    expect(MapsCategory.tags("clinic")).toEqual(["amenity=clinic|doctors", "healthcare=clinic|centre|doctor"])
    expect(MapsCategory.tags("attraction")).toContain("leisure=park|water_park|garden")
  })
})
