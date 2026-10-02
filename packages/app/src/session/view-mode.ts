import { createEffect, createSignal } from "solid-js"
import { Schema } from "effect"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useServerSDK } from "@/runtime/server/client"
import { useSettings, type ConversationViewMode } from "@/settings/model"

export type { ConversationViewMode }

// fork: persisted stores may still hold "laya" from before the rename.
export type StoredViewMode = ConversationViewMode | "laya"
export const normalizeViewMode = (value: StoredViewMode | undefined): ConversationViewMode | undefined =>
  value === "laya" ? "classifier" : value

const Mode = Persistence.fallback(Schema.UndefinedOr(Schema.Literals(["chat", "code", "classifier", "laya"])), () => undefined)
const SessionSchema = Persistence.struct({ session: Persistence.record(Schema.mutableKey(Mode)) })
const DraftSchema = Persistence.struct({ mode: Mode })

// Route transitions replace the provider tree. This handoff lets a choice made on a draft
// survive the moment the draft becomes a real session, before the session store reloads.
const handoff = new Map<string, ConversationViewMode>()

// fork: sessions keep their mode in one server-wide store (it must outlive the draft store the
// choice started in); drafts keep theirs in the draft store so it is cleaned up with the draft.
export function createConversationViewMode(input: {
  sessionID: () => string | undefined
  draftID?: () => string | undefined
}) {
  const settings = useSettings()
  const serverSDK = useServerSDK()
  const [pending, setPending] = createSignal<ConversationViewMode>()
  const [sessions, setSessions] = persisted(
    Persist.serverGlobal(serverSDK.scope, "conversation-view-mode"),
    SessionSchema,
    { session: {} },
  )
  const draftID = input.draftID?.()
  const [draft, setDraft] = persisted(
    draftID ? Persist.draft(draftID, "conversation-view-mode") : Persist.global("conversation-view-mode-draft-unused"),
    DraftSchema,
    { mode: undefined },
  )
  const draftMode = () => (draftID ? draft.mode : pending())
  // The draft screen is disposed mid-transition, before its store flushes. The session route owns
  // the durable write, so persist the handed-off choice from here.
  createEffect(() => {
    const id = input.sessionID()
    if (!id || sessions.session[id]) return
    const value = handoff.get(id)
    if (value) setSessions("session", id, value)
  })
  const current = () => {
    const id = input.sessionID()
    const raw = (id ? (sessions.session[id] ?? handoff.get(id)) : draftMode()) as StoredViewMode | undefined
    return normalizeViewMode(raw) ?? settings.general.defaultViewMode()
  }
  const set = (value: StoredViewMode) => {
    const normalized = normalizeViewMode(value) ?? settings.general.defaultViewMode()
    const id = input.sessionID()
    if (id) return setSessions("session", id, normalized)
    if (draftID) return setDraft("mode", normalized)
    setPending(normalized)
  }
  const promote = (id: string) => {
    const raw = draftMode() ?? settings.general.defaultViewMode()
    const value = normalizeViewMode(raw as StoredViewMode) ?? settings.general.defaultViewMode()
    handoff.set(id, value)
    setSessions("session", id, value)
  }
  return { current, set, promote }
}
