import { createSignal } from "solid-js"
import { Schema } from "effect"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { ScopedKey } from "@/runtime/server/scope"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSettings, type ConversationViewMode } from "@/settings/model"

export type { ConversationViewMode }

const StateSchema = Persistence.struct({
  session: Persistence.record(
    Schema.mutableKey(Persistence.fallback(Schema.UndefinedOr(Schema.Literals(["chat", "code", "laya"])), () => undefined)),
  ),
})

// Route transitions replace the provider tree. This handoff lets a choice made on a draft
// survive the moment the draft becomes a real session, even before the next route mounts.
const handoff = new Map<string, ConversationViewMode>()

export function createConversationViewMode(input: {
  sessionID: () => string | undefined
  draftID?: () => string | undefined
}) {
  const settings = useSettings()
  const location = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const [pending, setPending] = createSignal<ConversationViewMode>()
  const scopeKey = (sessionID: string) => ScopedKey.from(serverSDK.scope, location().directory, sessionID)
  const draftKey = (draftID: string) => `draft:${draftID}`
  const draftID = input.draftID?.()
  const [saved, setSaved] = persisted(
    draftID ? Persist.draft(draftID, "conversation-view-mode") : Persist.global("conversation-view-mode-unused"),
    StateSchema,
    { session: {} },
  )
  const current = () => {
    const id = input.sessionID()
    if (id) {
      const value = saved.session[id] ?? handoff.get(scopeKey(id))
      if (value) return value
    }
    const draftID = input.draftID?.()
    const value = draftID ? saved.session[draftKey(draftID)] : pending()
    return value ?? settings.general.defaultViewMode()
  }
  const set = (value: ConversationViewMode) => {
    const id = input.sessionID()
    if (id) {
      setSaved("session", id, value)
      return
    }
    const draftID = input.draftID?.()
    if (draftID) setSaved("session", draftKey(draftID), value)
    else setPending(value)
  }
  const promote = (id: string) => {
    const draftID = input.draftID?.()
    const value = (draftID ? saved.session[draftKey(draftID)] : pending()) ?? settings.general.defaultViewMode()
    handoff.set(scopeKey(id), value)
    setSaved("session", id, value)
  }
  return { current, set, promote }
}
