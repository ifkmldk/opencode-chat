import { createStore } from "solid-js/store"
import { onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { SelectionActionBar } from "@opencode/ui/selection-action-bar"

const HTML_SNIPPET_CAP = 2000
const TEXT_CAP = 4000
const DEBOUNCE_MS = 120

// fork: select text inside a rendered preview (tables, documents, markdown) and Quote / + Note it
// (v1 annotator). Scoped to one container so side-by-side previews only react to their own content.
// Once a selection is captured, later selectionchange events are ignored until the bar closes:
// focusing the note input collapses the page selection and must not read as a cancel.
export function TextSelectOverlay(props: {
  container: () => HTMLElement | undefined
  onAnnotate: (item: { text: string; html?: string }, comment?: string) => void
}) {
  const [state, setState] = createStore({
    rect: undefined as DOMRect | undefined,
    text: "",
    html: undefined as string | undefined,
  })
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => setState({ rect: undefined, text: "", html: undefined })

  const read = () => {
    const container = props.container()
    const selection = document.getSelection()
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return clear()
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return clear()
    const text = selection.toString()
    if (!text.trim()) return clear()
    const element =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
    setState({
      rect: range.getBoundingClientRect(),
      text: text.slice(0, TEXT_CAP),
      html: element?.outerHTML.slice(0, HTML_SNIPPET_CAP),
    })
  }

  onMount(() => {
    const onSelectionChange = () => {
      if (state.rect) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(read, DEBOUNCE_MS)
    }
    document.addEventListener("selectionchange", onSelectionChange)
    onCleanup(() => {
      document.removeEventListener("selectionchange", onSelectionChange)
      if (timer) clearTimeout(timer)
    })
  })

  const submit = (comment?: string) => {
    if (!state.rect) return
    props.onAnnotate({ text: state.text, html: state.html }, comment)
    document.getSelection()?.removeAllRanges()
    clear()
  }

  return (
    <Show when={state.rect}>
      {(rect) => (
        <Portal>
          <SelectionActionBar rect={rect()} onQuote={() => submit()} onNote={(text) => submit(text)} onCancel={clear} />
        </Portal>
      )}
    </Show>
  )
}
