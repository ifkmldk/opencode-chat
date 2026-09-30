import { createStore } from "solid-js/store"
import { emptyScene, type MapPoint, type MapScene } from "./scene"

// fork: per-session Map tab state, shared by the session screen (which folds the scene) and the side-panel pane.
type Focus = { id?: string; point?: MapPoint; at: number }
const [state, setState] = createStore<Record<string, { scene: MapScene; focus?: Focus }>>({})
const empty = emptyScene()

export const mapState = {
  scene: (session: string | undefined) => (session ? state[session]?.scene : undefined) ?? empty,
  focus: (session: string | undefined) => (session ? state[session]?.focus : undefined),
  place: (session: string | undefined, id: string) => (session ? state[session]?.scene.known[id] : undefined),
  setScene: (session: string, scene: MapScene) => setState(session, (current) => ({ ...current, scene })),
  setFocus: (session: string, focus: Omit<Focus, "at">) =>
    setState(session, (current) => ({ scene: current?.scene ?? empty, focus: { ...focus, at: Date.now() } })),
}
