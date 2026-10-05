import { describe, expect, test } from "bun:test"
import { isDirectFrame, webBrowserAddress } from "./address"

describe("webBrowserAddress", () => {
  test("words search on Google in its embeddable mode", () => {
    expect(webBrowserAddress("loker data analyst bandung")).toBe("https://www.google.com/search?igu=1&q=loker%20data%20analyst%20bandung")
  })
  test("Google addresses stay on Google and load directly", () => {
    expect(webBrowserAddress("https://www.google.com/search?q=hotel+bsd")).toBe("https://www.google.com/search?igu=1&q=hotel%20bsd")
    expect(webBrowserAddress("google.com")).toBe("https://www.google.com/webhp?igu=1")
    expect(isDirectFrame(webBrowserAddress("google.com"))).toBe(true)
    expect(isDirectFrame("https://www.google.com/search?q=x")).toBe(false)
    expect(isDirectFrame("https://glints.com/?igu=1")).toBe(false)
  })
  test("other addresses stay as typed", () => {
    expect(webBrowserAddress("glints.com")).toBe("https://glints.com")
    expect(webBrowserAddress("https://maps.google.com/x")).toBe("https://maps.google.com/x")
  })
})
