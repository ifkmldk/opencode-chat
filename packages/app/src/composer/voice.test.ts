import { describe, expect, test } from "bun:test"
import { appendVoiceTranscript, isVoiceInputSupported, voiceRecognitionCtor } from "./voice"

describe("voice input", () => {
  test("appends transcripts with spacing", () => {
    expect(appendVoiceTranscript("", "hello")).toBe("hello")
    expect(appendVoiceTranscript("  ", "hello")).toBe("hello")
    expect(appendVoiceTranscript("find hotels", "in Bali")).toBe("find hotels in Bali")
    expect(appendVoiceTranscript("find hotels  ", "in Bali")).toBe("find hotels in Bali")
    expect(appendVoiceTranscript("find hotels", "   ")).toBe("find hotels")
  })

  test("detects support without a browser", () => {
    expect(isVoiceInputSupported({})).toBe(false)
    expect(voiceRecognitionCtor({})).toBeUndefined()
    class FakeRecognition {
      lang = ""
      interimResults = false
      maxAlternatives = 1
      onresult = null
      onend = null
      onerror = null
      start() {}
      stop() {}
    }
    expect(isVoiceInputSupported({ SpeechRecognition: FakeRecognition })).toBe(true)
    expect(voiceRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
  })
})
