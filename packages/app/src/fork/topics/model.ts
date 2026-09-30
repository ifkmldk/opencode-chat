import { createStore } from "solid-js/store"

// fork: Topics (v1). Client-only named groups for organizing sessions on Home. The server has no notion
// of topics, so topics and session assignments live in localStorage.

export type Topic = { id: string; name: string; color: string }

type State = { list: Topic[]; assignments: Record<string, string>; selected: string | null }

const STORAGE_KEY = "opencode.global.dat:fork.topics"
const COLORS = ["#f97066", "#f79009", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef", "#ec4899"]

const [store, setStore] = createStore<State>(read())

function read(): State {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return {
      list: Array.isArray(value?.list) ? value.list : [],
      assignments: value?.assignments && typeof value.assignments === "object" ? value.assignments : {},
      selected: typeof value?.selected === "string" ? value.selected : null,
    }
  } catch {
    return { list: [], assignments: {}, selected: null }
  }
}

function write() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked: topics still work for this page load.
  }
}

export const Topics = {
  list: () => store.list,
  selected: () => store.selected,
  select(id: string | null) {
    setStore("selected", id)
    write()
  },
  topicFor: (sessionID: string) => store.assignments[sessionID] as string | undefined,
  create(name: string) {
    const topic = {
      id: crypto.randomUUID().slice(0, 8),
      name: name.trim(),
      color: COLORS[store.list.length % COLORS.length],
    }
    setStore("list", store.list.length, topic)
    write()
    return topic
  },
  rename(id: string, name: string) {
    if (!name.trim()) return
    setStore("list", (topic) => topic.id === id, "name", name.trim())
    write()
  },
  remove(id: string) {
    setStore("list", (list) => list.filter((topic) => topic.id !== id))
    setStore("assignments", (assignments) =>
      Object.fromEntries(Object.entries(assignments).filter(([, topic]) => topic !== id)),
    )
    if (store.selected === id) setStore("selected", null)
    write()
  },
  assign(sessionID: string, topicID: string | null) {
    setStore("assignments", (assignments) => {
      const next = { ...assignments }
      if (topicID) next[sessionID] = topicID
      else delete next[sessionID]
      return next
    })
    write()
  },
  /** A session created while a topic filter is active belongs to that topic. */
  adopt(sessionID: string) {
    if (store.selected && !store.assignments[sessionID]) Topics.assign(sessionID, store.selected)
  },
}
