import { createEffect } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import type { SessionModel } from "@/session/model"
import { useSessionLayout } from "@/session/session-layout"
import { canvasUrlFrom, isCanvasTool } from "./canvas"
import { useWebBrowser, webBrowserTab } from "./model"

function toolInput(tool: SessionMessageAssistantTool) {
  return tool.state.status === "streaming" ? {} : tool.state.input
}

function toolOutput(tool: SessionMessageAssistantTool) {
  if (!("content" in tool.state) || !tool.state.content) return undefined
  return tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
}

/**
 * fork: a canvas tool that finishes while the session is open shows its page in a side-panel browser tab,
 * reusing the tab that already shows the canvas server. Watches the latest assistant message rather than tool
 * cards: in Code Mode the call is an `execute` card that remounts into a collapsed group when it completes.
 * Only tools first seen unfinished count, so opening an old session never pops the canvas.
 */
export function CanvasOpenListener(props: { session: SessionModel }) {
  const { tabs, view } = useSessionLayout()
  const web = useWebBrowser()
  const running = new Set<string>()
  const settled = new Set<string>()

  const open = (url: string) => {
    const id = web.find(url) ?? web.create()
    web.navigate(id, url)
    const tab = webBrowserTab(id)
    tabs().open(tab)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    tabs().setActive(tab)
  }

  createEffect(() => {
    const last = props.session.history.messages().at(-1)
    if (!last || last.type !== "assistant") return
    for (const item of last.content) {
      if (item.type !== "tool" || settled.has(item.id)) continue
      if (item.state.status !== "completed" && item.state.status !== "error") {
        running.add(item.id)
        continue
      }
      settled.add(item.id)
      if (!running.delete(item.id) || item.state.status !== "completed") continue
      if (!isCanvasTool(item.name, toolInput(item))) continue
      const url = canvasUrlFrom(toolOutput(item))
      if (url) open(url)
    }
  })
  return null
}
