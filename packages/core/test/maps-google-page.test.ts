import { describe, expect, test } from "bun:test"
import { MapsCompany } from "../src/maps/company"
import { MapsGooglePage } from "../src/maps/google-page"
import { MapsOsm } from "../src/maps/osm"

describe("Google Maps page", () => {
  test("coordinates come from !3d!4d, and from @lat,lng only on a place page", () => {
    expect(
      MapsGooglePage.coordinates(
        "https://www.google.com/maps/place/Cermati.com+%28Operational+Office%29/data=!4m7!3m6!1s0x2e69:0xbb!8m2!3d-6.1769507!4d106.8007962!16s%2Fg%2F11bt",
      ),
    ).toEqual({ latitude: -6.1769507, longitude: 106.8007962 })
    expect(MapsGooglePage.coordinates("https://www.google.com/maps/place/Menara+Astra/@-6.2,106.82,17z/data=!4m6")).toEqual({
      latitude: -6.2,
      longitude: 106.82,
    })
    // On a search page "@" is only where the map is centred.
    expect(MapsGooglePage.coordinates("https://www.google.com/maps/search/PT+Cermati/@-6.18,106.81,15z/data=!3m1!4b1")).toBeUndefined()
    expect(MapsGooglePage.coordinates("https://www.google.com/maps/place/X/data=!3d-95!4d106")).toBeUndefined()
  })

  test("a result list gives each place's name, point and address; a consent or captcha page gives up", () => {
    const html = `<div><a class="hfpxzc" aria-label="Cermati.com (Operational Office)" href="https://www.google.com/maps/place/Cermati/data=!4m7!3m6!8m2!3d-6.1769507!4d106.8007962!16s?authuser=0&amp;hl=id"></a>
      <div><span>Kantor perusahaan</span><span>·</span><span>Jl. Kebon Sirih No.17</span></div></div>
      <div><a class="hfpxzc" aria-label="Cermati Protect" href="https://www.google.com/maps/place/Cermati+Protect/data=!8m2!3d-6.1922247!4d106.8234709"></a></div>`
    const answer = MapsGooglePage.parse(html, "https://www.google.com/maps/search/PT+Cermati+Jakarta/@-6.18,106.81,15z")
    expect(answer.blocked).toBeUndefined()
    expect(answer.hits).toHaveLength(2)
    expect(answer.hits[0]).toMatchObject({ name: "Cermati.com (Operational Office)", latitude: -6.1769507, longitude: 106.8007962, address: "Jl. Kebon Sirih No.17" })
    expect(MapsGooglePage.parse("<html>Before you continue to Google</html>", "https://consent.google.com/ml?continue=x").blocked).toBe(true)
    expect(MapsGooglePage.parse("<form id=captcha-form>", "https://www.google.com/sorry/index?continue=x").blocked).toBe(true)
  })

  test("a place page gives its own name and address", () => {
    const html = `<h1 class="DUwDvf">Menara Astra</h1><button data-item-id="address" aria-label="Alamat: Jl. Jend. Sudirman Kav. 5-6, Jakarta"></button>`
    const answer = MapsGooglePage.parse(html, "https://www.google.com/maps/place/Menara+Astra/@-6.2,106.82,17z/data=!3d-6.2001!4d106.8212")
    expect(answer.hits).toEqual([
      { name: "Menara Astra", latitude: -6.2001, longitude: 106.8212, address: "Jl. Jend. Sudirman Kav. 5-6, Jakarta", url: expect.any(String) },
    ])
  })

  test("only a place named like the company inside the region is accepted", () => {
    const hit = (name: string, latitude: number, longitude: number) => ({ name, latitude, longitude, url: "https://www.google.com/maps/place/x" })
    const key = MapsCompany.normalizeCompany("PT Cermati Indonesia")
    const match = MapsCompany.googleMatch(
      key,
      [hit("Pt Dwi Cermat Indonesia", -6.17, 106.8), hit("Cermati.com (Operational Office)", -6.1769, 106.8008), hit("Cermati", 1.3, 103.8)],
      MapsOsm.JABODETABEK,
    )
    expect(match?.hit.name).toBe("Cermati.com (Operational Office)")
    expect(match?.elsewhere).toBe(0)
    // A branch with extra words is not the company's office.
    expect(MapsCompany.googleMatch(MapsCompany.normalizeCompany("PT Bank Mandiri"), [hit("Bank Mandiri KCP Jakarta Grand Indonesia", -6.19, 106.82)], MapsOsm.JABODETABEK)).toBeUndefined()
  })
})
