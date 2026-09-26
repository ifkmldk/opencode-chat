import { getSpeechRecognitionCtor } from "@/session/terminal/runtime-adapters"

/** Browser Web Speech recognizer shape used by the composer voice button. */
export type VoiceRecognizer = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

/** Browser Web Speech constructor, or undefined where unsupported. No server involved. */
export function voiceRecognitionCtor(host?: unknown): (new () => VoiceRecognizer) | undefined {
  const scope = host ?? (typeof window !== "undefined" ? window : undefined)
  return getSpeechRecognitionCtor<VoiceRecognizer>(scope)
}

/** Whether dictation can be offered on this host. */
export function isVoiceInputSupported(host?: unknown) {
  return voiceRecognitionCtor(host) !== undefined
}

/** Append a final voice transcript to the current draft text. Pure and tested. */
export function appendVoiceTranscript(current: string, transcript: string) {
  const text = transcript.trim()
  if (!text) return current
  if (!current.trim()) return text
  return `${current.replace(/\s+$/, "")} ${text}`
}
