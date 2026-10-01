import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"

const MESSAGE_SELECTOR =
  '[data-component="user-message"], [data-component="text-part"], [data-component="reasoning-part"]'

type ChatSelectionTarget = {
  messageID: string
  partID?: string
  role: "user" | "assistant"
  text: string
  rect: DOMRect
  range: Range
}

// fork: the captured range stays highlighted while the note box has focus (the native selection is gone by then),
// so it is always visible exactly what the quote will contain.
const HIGHLIGHT = "opencode-quote"
type Highlights = { set: (name: string, value: unknown) => void; delete: (name: string) => void }
const highlights = () => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights
const HighlightCtor = () => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
function paint(range: Range | undefined) {
  const registry = highlights()
  const Ctor = HighlightCtor()
  if (!registry || !Ctor) return
  if (!range) return registry.delete(HIGHLIGHT)
  registry.set(HIGHLIGHT, new Ctor(range))
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
  const range = selection.getRangeAt(0).cloneRange()
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  return { messageID, partID, role, text, rect, range }
}

export function ChatSelectionAnnotator(props: {
  onQuote: (item: {
    messageID: string
    partID?: string
    quotedText: string
    role: "user" | "assistant"
    comment?: string
  }) => void
}) {
  const [target, setTarget] = createSignal<ChatSelectionTarget>()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  // fork: always follow the latest selection. The first version kept whatever was selected when the drag paused
  // for 120 ms, so a slow drag quoted only its first word ("Promo" of "Promo ROI tab: …").
  const inBar = () => !!document.activeElement?.closest('[data-component="selection-action-bar"]')
  const check = () => {
    const selection = document.getSelection()
    const next = selection && !selection.isCollapsed ? resolveTarget(selection) : undefined
    if (next) return set(next)
    // Typing a note moves focus (and the selection) into the bar: keep the captured quote.
    if (inBar()) return
    if (selection && !selection.isCollapsed) return
    set(undefined)
  }
  const set = (next: ChatSelectionTarget | undefined) => {
    setTarget(next)
    paint(next?.range)
  }

  const onSelectionChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(check, 120)
  }
  // Settle as soon as the drag ends instead of waiting for the debounce.
  const onPointerUp = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    queueMicrotask(check)
  }

  onMount(() => {
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("pointerup", onPointerUp)
  })
  onCleanup(() => {
    document.removeEventListener("selectionchange", onSelectionChange)
    document.removeEventListener("pointerup", onPointerUp)
    if (debounceTimer) clearTimeout(debounceTimer)
    paint(undefined)
  })

  const dismiss = () => {
    document.getSelection()?.removeAllRanges()
    set(undefined)
  }

  return (
    <Show when={target()}>
      {(current) => (
        <Portal>
          <SelectionActionBar
            rect={current().rect}
            preview={current().text}
            onQuote={() => {
              const t = current()
              props.onQuote({ messageID: t.messageID, partID: t.partID, quotedText: t.text, role: t.role })
              dismiss()
            }}
            onNote={(note) => {
              const t = current()
              props.onQuote({
                messageID: t.messageID,
                partID: t.partID,
                quotedText: t.text,
                role: t.role,
                comment: note,
              })
              dismiss()
            }}
            onCancel={dismiss}
          />
        </Portal>
      )}
    </Show>
  )
}
