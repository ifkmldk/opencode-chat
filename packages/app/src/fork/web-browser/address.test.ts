import { describe, expect, test } from "bun:test"
import { webBrowserAddress } from "./address"

describe("webBrowserAddress", () => {
  test("words search on Bing", () => expect(webBrowserAddress("loker data analyst bandung")).toBe("https://www.bing.com/search?q=loker%20data%20analyst%20bandung"))
  test("Google searches move to Bing with the same words", () => {
    expect(webBrowserAddress("https://www.google.com/search?q=hotel+bsd")).toBe("https://www.bing.com/search?q=hotel%20bsd")
    expect(webBrowserAddress("google.com")).toBe("https://www.bing.com/")
  })
  test("other addresses stay as typed", () => {
    expect(webBrowserAddress("glints.com")).toBe("https://glints.com")
    expect(webBrowserAddress("https://maps.google.com/x")).toBe("https://maps.google.com/x")
  })
})
