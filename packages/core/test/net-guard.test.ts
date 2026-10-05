import { describe, expect, test } from "bun:test"
import { NetGuard } from "../src/net-guard"

describe("NetGuard", () => {
  test.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.255", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "[::1]"])(
    "%s is private",
    (address) => {
      expect(NetGuard.isPrivateAddress(address)).toBe(true)
    },
  )

  test.each(["8.8.8.8", "93.184.215.14", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:5db8:d70e"])("%s is public", (address) => {
    expect(NetGuard.isPrivateAddress(address)).toBe(false)
  })

  test("refuses loopback, metadata and local names with an actionable message", async () => {
    await expect(NetGuard.assertPublicUrl("http://127.0.0.1:20128/v1/models")).rejects.toThrow("OPENCODE_FETCH_ALLOW_HOSTS")
    await expect(NetGuard.assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow("private")
    await expect(NetGuard.assertPublicUrl("http://localhost:4096/api/info")).rejects.toThrow("local network name")
    await expect(NetGuard.assertPublicUrl("http://2130706433/")).rejects.toThrow("private")
    await expect(NetGuard.assertPublicUrl("http://[::ffff:7f00:1]/")).rejects.toThrow("private")
  })

  test("public addresses pass, and the owner can allow hosts on purpose", async () => {
    await NetGuard.assertPublicUrl("https://93.184.215.14/")
    await NetGuard.assertPublicUrl("http://localhost:3000/", { OPENCODE_FETCH_ALLOW_HOSTS: "localhost:3000" })
    await NetGuard.assertPublicUrl("http://10.0.0.5/", { OPENCODE_FETCH_ALLOW_PRIVATE: "1" })
    await expect(NetGuard.assertPublicUrl("http://localhost:3001/", { OPENCODE_FETCH_ALLOW_HOSTS: "localhost:3000" })).rejects.toThrow()
  })
})
