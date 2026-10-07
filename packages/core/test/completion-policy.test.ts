import { describe, expect, test } from "bun:test"
import { repeatedNarration, workedSinceLastUser } from "../src/session/runner/completion-policy"

describe("workedSinceLastUser", () => {
  test("a plain answer has no tool work", () => {
    expect(workedSinceLastUser([{ type: "user" }, { type: "assistant", content: [{ type: "text" }] } as never])).toBe(false)
  })

  test("tool activity after the last user message counts as work", () => {
    expect(workedSinceLastUser([{ type: "user" }, { type: "assistant", content: [{ type: "tool" }] } as never])).toBe(true)
  })

  test("tools used for an earlier question do not count for the new one", () => {
    expect(
      workedSinceLastUser([
        { type: "user" },
        { type: "assistant", content: [{ type: "tool" }] } as never,
        { type: "user" },
        { type: "assistant", content: [{ type: "text" }] } as never,
      ]),
    ).toBe(false)
  })
})

describe("repeatedNarration", () => {
  const say = (text: string) => ({ type: "assistant", content: [{ type: "text", text }, { type: "tool" }] }) as never
  const opener = "Siap, saya cek ulang lebih lengkap — saya tarik dulu semua loker"

  test("the same opener three times in one turn is flagged, even with a different ending", () => {
    expect(repeatedNarration([{ type: "user" }, say(`${opener} Bandung.`), say(`${opener} Cimahi!`), say(`${opener} berlapis.`)])).toBe(true)
  })

  test("two repeats or varied openers are fine", () => {
    expect(repeatedNarration([{ type: "user" }, say(opener), say(opener)])).toBe(false)
    expect(repeatedNarration([{ type: "user" }, say("Saya cek halaman karir resmi PT Sasa Inti"), say("Saya bandingkan hasil Jobstreet dan LinkedIn"), say("Saya susun tabel akhir dengan tautan lamar")])).toBe(false)
  })

  test("repeats from an earlier user turn do not count", () => {
    expect(repeatedNarration([{ type: "user" }, say(opener), say(opener), say(opener), { type: "user" }, say(opener)])).toBe(false)
  })
})
