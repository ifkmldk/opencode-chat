import { describe, expect, test } from "bun:test"
import { Geo } from "../src/maps/geo.js"
import { Stations } from "../src/maps/stations.js"

const names = (stations: readonly Stations.Station[]) => stations.map((station) => station.name)

describe("station data", () => {
  test("every KRL line has a plausible number of stations", () => {
    const count = (line: string) => Stations.list({ lines: [line] }).length
    expect(count("rangkasbitung")).toBeGreaterThanOrEqual(19)
    expect(count("bogor")).toBeGreaterThanOrEqual(24)
    expect(count("cikarang")).toBeGreaterThanOrEqual(20)
    expect(count("tangerang")).toBeGreaterThanOrEqual(10)
    expect(count("tanjung-priok")).toBeGreaterThanOrEqual(3)
    expect(names(Stations.list({ lines: ["rangkasbitung"] }))).toContain("Jatake")
    expect(names(Stations.list({ lines: ["bogor"] }))).toEqual(expect.arrayContaining(["Bogor", "Nambo", "Cibinong"]))
    expect(names(Stations.list({ lines: ["cikarang"] }))).toEqual(
      expect.arrayContaining([
        "Sudirman",
        "Tanah Abang",
        "Duri",
        "Angke",
        "Kampung Bandan",
        "Pasar Senen",
        "Jatinegara",
        "Manggarai",
        "Cikarang",
      ]),
    )
  })

  test("stations are OSM railway objects inside Jabodetabek with consistent line membership", () => {
    const all = [...Stations.list(), ...Stations.list({ modes: ["mrt", "lrt"] })]
    expect(new Set(all.map((station) => station.id)).size).toBe(all.length)
    all.forEach((station) => {
      expect(station.id).toMatch(/^osm:(node|way)\/\d+$/)
      expect(station.latitude).toBeGreaterThan(-6.8)
      expect(station.latitude).toBeLessThan(-5.9)
      expect(station.longitude).toBeGreaterThan(105.9)
      expect(station.longitude).toBeLessThan(107.3)
      expect(station.lines.length).toBeGreaterThan(0)
      station.lines.forEach((id) => {
        const line = Stations.LINES.find((item) => item.id === id)
        expect(line?.stations).toContain(station.id)
        expect(line?.mode).toBe(station.mode)
      })
    })
    expect(Stations.find("Cisauk")?.aliases).toContain("Stasiun Cisauk")
    expect(Stations.find("Parungpanjang")?.aliases).toContain("Parung Panjang")
  })

  test("airport-only and Merak-line stations are not KRL Jabodetabek stations", () => {
    const krl = names(Stations.list())
    expect(krl).not.toContain("Bandara Soekarno-Hatta")
    expect(krl).not.toContain("Serang")
    expect(krl).not.toContain("Merak")
    expect(krl).not.toContain("Karawang")
  })
})

describe("Stations.list", () => {
  test("defaults to KRL only; an empty line filter means every line", () => {
    const krl = Stations.list()
    expect(krl.length).toBeGreaterThan(70)
    expect(krl.every((station) => station.mode === "krl")).toBe(true)
    expect(Stations.list({ lines: [] })).toEqual(krl)
  })

  test("filters by line in running order and by mode", () => {
    const rangkas = Stations.list({ lines: ["rangkasbitung"] })
    expect(rangkas[0]?.name).toBe("Tanah Abang")
    expect(rangkas.at(-1)?.name).toBe("Rangkasbitung")
    expect(names(rangkas).indexOf("Jatake")).toBe(names(rangkas).indexOf("Cicayur") + 1)
    expect(Stations.list({ lines: ["mrt-jakarta"] }).every((station) => station.mode === "mrt")).toBe(true)
    expect(Stations.list({ modes: ["mrt"] }).length).toBeGreaterThanOrEqual(13)
    expect(Stations.list({ lines: ["rangkasbitung"], modes: ["mrt"] })).toEqual([])
    const both = Stations.list({ lines: ["tangerang", "tanjung-priok"] })
    expect(new Set(both.map((station) => station.id)).size).toBe(both.length)
  })
})

describe("Stations.find", () => {
  test("accepts prefixes, suffixes, case and spacing variants", () => {
    for (const text of [
      "Stasiun Cisauk",
      "St. Cisauk",
      "Cisauk station",
      "CISAUK",
      "stasiun krl cisauk",
      "Stasiun Cisauk, Tangerang",
    ])
      expect(Stations.find(text)?.name).toBe("Cisauk")
    for (const text of ["Jurang Mangu", "Jurangmangu", "Stasiun Jurang Mangu"])
      expect(Stations.find(text)?.name).toBe("Jurangmangu")
    for (const text of ["Parung Panjang", "Parungpanjang", "stasiun parung panjang"])
      expect(Stations.find(text)?.name).toBe("Parungpanjang")
    expect(Stations.find("Rawabuntu")?.name).toBe("Rawa Buntu")
    expect(Stations.find("Stasiun Tanjung Priok")?.lines).toContain("tanjung-priok")
  })

  test("Sudirman is the KRL station, not an MRT stop", () => {
    for (const text of [
      "Stasiun Sudirman",
      "Stasiun Sudirman Jakarta",
      "Stasiun Sudirman, Jakarta Pusat",
      "Sudirman",
    ]) {
      const station = Stations.find(text)
      expect(station?.name).toBe("Sudirman")
      expect(station?.mode).toBe("krl")
      expect(station?.lines).toContain("cikarang")
    }
  })

  test("names inside a station text pick the longest match", () => {
    expect(Stations.find("stasiun bekasi timur kota bekasi")?.name).toBe("Bekasi Timur")
    expect(Stations.find("Stasiun Tangerang")?.name).toBe("Tangerang")
    expect(Stations.find("Tangerang Selatan")).toBeUndefined()
    expect(Stations.find("Stasiun Gambir")).toBeUndefined()
  })

  test("mode hints and filters choose between same-named stations", () => {
    expect(Stations.find("Cawang")?.mode).toBe("krl")
    expect(Stations.find("LRT Cawang")?.mode).toBe("lrt")
    expect(Stations.find("Cawang", { modes: ["lrt"] })?.mode).toBe("lrt")
    expect(Stations.find("Stasiun MRT Blok M")?.mode).toBe("mrt")
    expect(Stations.find("Cisauk", { lines: ["bogor"] })).toBeUndefined()
  })

  test("tolerates a small typo in longer names", () => {
    expect(Stations.find("Jurangmanggu")?.name).toBe("Jurangmangu")
    expect(Stations.find("Rangkasbitng")?.name).toBe("Rangkasbitung")
  })
})

describe("Stations.nearest", () => {
  test("finds the closest KRL station across all lines by default", () => {
    const palmerah = Stations.find("Palmerah")!
    const office = Geo.destination(palmerah, 90, 300)
    const near = Stations.nearest(office)
    expect(near).toHaveLength(1)
    expect(near[0]?.station.name).toBe("Palmerah")
    expect(near[0]?.meters).toBeCloseTo(300, 0)
    const bogor = Stations.find("Bogor")!
    expect(Stations.nearest(Geo.destination(bogor, 0, 200))[0]?.station.name).toBe("Bogor")
  })

  test("sorts k results and honours line and mode filters", () => {
    const sudirman = Stations.find("Sudirman")!
    const three = Stations.nearest(sudirman, { k: 3 })
    expect(three).toHaveLength(3)
    expect(three[0]?.station.name).toBe("Sudirman")
    expect(three[0]?.meters).toBe(0)
    expect(three.map((entry) => entry.meters)).toEqual(three.map((entry) => entry.meters).toSorted((a, b) => a - b))
    expect(Stations.nearest(sudirman, { modes: ["mrt"] })[0]?.station.mode).toBe("mrt")
    const manggarai = Stations.find("Manggarai")!
    const onRangkas = Stations.nearest(manggarai, { lines: ["rangkasbitung"] })[0]
    expect(onRangkas?.station.lines).toContain("rangkasbitung")
    expect(onRangkas?.station.name).toBe("Tanah Abang")
    const blokM = Stations.find("Blok M")!
    expect(Stations.nearest(blokM)[0]?.station.mode).toBe("krl")
  })
})

describe("Stations.linesFromText", () => {
  test("reads named KRL lines", () => {
    expect(Stations.linesFromText("line rangkas bitung")).toEqual(["rangkasbitung"])
    expect(Stations.linesFromText("bogor line")).toEqual(["bogor"])
    expect(Stations.linesFromText("loker dekat KRL jalur Bogor")).toEqual(["bogor"])
    expect(Stations.linesFromText("jalur serpong")).toEqual(["rangkasbitung"])
    expect(Stations.linesFromText("KRL Tangerang")).toEqual(["tangerang"])
    expect(Stations.linesFromText("commuter line Cikarang atau jalur Tanjung Priok")).toEqual([
      "cikarang",
      "tanjung-priok",
    ])
  })

  test("KRL alone, all lines and plain city names mean no specific line", () => {
    expect(Stations.linesFromText("KRL")).toEqual([])
    expect(Stations.linesFromText("semua jalur KRL")).toEqual([])
    expect(Stations.linesFromText("kantor di Bogor")).toEqual([])
    expect(Stations.linesFromText("KRL Tangerang Selatan")).toEqual([])
  })

  test("MRT and LRT lines, keeping KRL when it is named too", () => {
    expect(Stations.linesFromText("dekat MRT")).toEqual(["mrt-jakarta"])
    expect(Stations.linesFromText("LRT Jabodebek")).toEqual(["lrt-jabodebek"])
    const mixed = Stations.linesFromText("dekat KRL atau MRT")
    expect(mixed).toContain("mrt-jakarta")
    expect(mixed).toEqual(expect.arrayContaining(["bogor", "cikarang", "rangkasbitung", "tangerang", "tanjung-priok"]))
  })
})
