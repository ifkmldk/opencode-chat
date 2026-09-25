import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"

const MESSAGE_SELECTOR = '[data-component="user-message"], [data-component="text-part"], [data-component="reasoning-part"]'

type ChatSelectionTarget = {
  messageID: string
  partID?: string
  role: "user" | "assistant"
  text: string
  rect: DOMRect
}

function resolveTarget(selection: Selection): ChatSelectionTarget | undefined {
  if (selection.isCollapsed) return
  const text = selection.toString()
  if (!text.trim()) return
  const anchor = selection.anchorNode
  if (!anchor) return
  const anchorElement = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement
  const messageElement = anchorElement?.closest(MESSAGE_SELECTOR)
  if (!messageElement) return
  const turnElement = messageElement.closest("[data-message-id]")
  const messageID = turnElement?.getAttribute("data-message-id")
  if (!messageID) return
  const partID = messageElement.getAttribute("data-timeline-part-id") ?? undefined
  const role = messageElement.getAttribute("data-component") === "user-message" ? "user" : "assistant"
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  return { messageID, partID, role, text, rect }
}

export function ChatSelectionAnnotator(props: {
  onQuote: (item: { messageID: string; partID?: string; quotedText: string; role: "user" | "assistant"; comment?: string }) => void
}) {
  const [target, setTarget] = createSignal<ChatSelectionTarget>()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    if (target()) return
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed) return
    setTarget(resolveTarget(selection))
  }

  const onSelectionChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(check, 120)
  }

  onMount(() => {
    document.addEventListener("selectionchange", onSelectionChange)
  })
  onCleanup(() => {
    document.removeEventListener("selectionchange", onSelectionChange)
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  const dismiss = () => {
    document.getSelection()?.removeAllRanges()
    setTarget(undefined)
  }

  return (
    <Show when={target()}>
      {(current) => (
        <Portal>
          <SelectionActionBar
            rect={current().rect}
            onQuote={() => {
              const t = current()
              props.onQuote({ messageID: t.messageID, partID: t.partID, quotedText: t.text, role: t.role })
              dismiss()
            }}
            onNote={(note) => {
              const t = current()
              props.onQuote({ messageID: t.messageID, partID: t.partID, quotedText: t.text, role: t.role, comment: note })
              dismiss()
            }}
            onCancel={dismiss}
          />
        </Portal>
      )}
    </Show>
  )
}