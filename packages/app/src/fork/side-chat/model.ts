import type { SessionMessageInfo } from "@opencode/client/promise"
import { createStore } from "solid-js/store"

// fork: Side chat (v1). A second, independent session opened in the side panel next to the main one,
// remembered per main session so reopening the tab reuses it. Client-side only: the server has no
// notion of "this session's side chat", so the mapping lives in localStorage.

export { SIDE_CHAT_TAB } from "./tab"

// Every send carries the main conversation as background, newest-first within this budget, so the side
// question is answered with the same context without a live cross-session link.
const MAIN_CONTEXT_CHAR_BUDGET = 40_000
const STORAGE_KEY = "opencode.global.dat:fork.side-chat"

type Entry = { sessionID: string; directory: string }

const [store, setStore] = createStore<{ bySession: Record<string, Entry> }>({ bySession: read() })

function read(): Record<string, Entry> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    return value && typeof value === "object" ? value : {}
  } catch {
    return {}
  }
}

function write() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.bySession))
  } catch {
    // Storage full or blocked: the side chat still works for this page load.
  }
}

export const SideChat = {
  for: (mainSessionID: string) => store.bySession[mainSessionID] as Entry | undefined,
  set(mainSessionID: string, entry: Entry) {
    setStore("bySession", mainSessionID, entry)
    write()
  },
  clear(mainSessionID: string) {
    setStore("bySession", mainSessionID, undefined!)
    write()
  },
  /** Main session IDs whose side chat is `sessionID`, for nesting in the session list. */
  parentOf: (sessionID: string) =>
    Object.entries(store.bySession).find(([, entry]) => entry.sessionID === sessionID)?.[0],
}

/** The main conversation as plain text, trimmed to the budget from the newest message backwards. */
export function mainSessionContext(messages: readonly SessionMessageInfo[]) {
  const lines = messages.flatMap((message) => {
    if (message.type === "user") return message.text.trim() ? [`[user] ${message.text.trim()}`] : []
    if (message.type !== "assistant") return []
    const text = message.content
      .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
      .join("\n")
    return text ? [`[assistant] ${text}`] : []
  })
  const kept = lines.reduceRight<{ lines: string[]; used: number; full: boolean }>(
    (acc, line) => {
      if (acc.full || acc.used + line.length > MAIN_CONTEXT_CHAR_BUDGET) return { ...acc, full: true }
      return { lines: [line, ...acc.lines], used: acc.used + line.length, full: false }
    },
    { lines: [], used: 0, full: false },
  ).lines
  if (!kept.length) return
  const omitted = lines.length - kept.length
  return `${omitted > 0 ? `[${omitted} earlier message(s) omitted for length]\n` : ""}${kept.join("\n\n")}`
}

export function sideChatPrompt(context: string | undefined, text: string) {
  if (!context) return text
  return `<main_session_context note="background reference only — respond to the message after this block">\n${context}\n</main_session_context>\n\n${text}`
}
