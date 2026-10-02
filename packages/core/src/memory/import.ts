// fork: one-shot session importer. Reads session stores read-only, summarizes
// deterministically (no LLM, no quota), writes MemoryStore + vault mirror.
export * as MemoryImport from "./import.js"

import { createHash, randomUUID } from "crypto"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

export type ImportSource = "opencode" | "claude-code" | "claude-transcript" | "claude-desktop" | "cline" | "manual-inbox"

export type RawMessage = { role: "user" | "assistant" | "system"; text: string }

export type RawSession = {
  source: ImportSource
  externalID: string
  title: string
  project?: string
  updatedAt: number
  messages: RawMessage[]
}

export type ImportedFact = { kind: "fact" | "preference" | "decision" | "correction" | "person" | "project-brief"; title: string; body: string }

const MAX_FACTS = 6
const MAX_TITLE = 120
const MAX_BODY = 2000

const NOISE = /^(test|tes|halo|hai|hi|hello|ok|oke|siap|thanks|thank you|makasih|\.+)$/i

export const summarizeDeterministic = (raw: RawSession): { title: string; facts: ImportedFact[]; skipReason?: string } => {
  const userTexts = raw.messages.filter((m) => m.role === "user").map((m) => m.text.trim()).filter(Boolean)
  const firstUser = userTexts[0] ?? ""
  const lastUser = userTexts[userTexts.length - 1] ?? ""
  if (!firstUser && !lastUser) return { title: raw.title || raw.externalID, facts: [], skipReason: "no user text" }
  if (userTexts.length <= 1 && NOISE.test(firstUser)) return { title: raw.title || firstUser, facts: [], skipReason: "noise only" }
  const title = (raw.title || firstUser).slice(0, MAX_TITLE) || raw.externalID
  const facts: ImportedFact[] = []
  const push = (kind: ImportedFact["kind"], title: string, body: string) => {
    if (facts.length >= MAX_FACTS) return
    const clean = body.trim().slice(0, MAX_BODY)
    if (clean.length < 20) return
    facts.push({ kind, title: title.slice(0, MAX_TITLE), body: clean })
  }
  const topic = firstUser.slice(0, 500)
  const outcome = lastUser !== firstUser ? lastUser.slice(0, 500) : ""
  const overview = `Topik awal: ${topic}${outcome ? `\nPerkembangan: ${outcome}` : ""}\nSumber: ${raw.source}/${raw.externalID}${raw.project ? ` (project ${raw.project})` : ""}`
  push("fact", `Session ${raw.source}: ${title.slice(0, 60)}`, overview)
  return facts.length > 0 ? { title, facts } : { title, facts, skipReason: "no extractable facts" }
}

export const fingerprint = (raw: RawSession) => createHash("sha256").update(`${raw.source}:${raw.externalID}`).digest("hex").slice(0, 16)

export const entryIDFor = (raw: RawSession) => `${fingerprint(raw)}-0`

export const vaultID = () => randomUUID()

export { readdirSync, readFileSync, statSync, join }
