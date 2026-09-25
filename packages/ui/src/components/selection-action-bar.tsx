import { createSignal, Show } from "solid-js"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"

export function SelectionActionBar(props: {
  rect: DOMRect
  onQuote: () => void
  onNote: (text: string) => void
  onCancel: () => void
}) {
  const [noteOpen, setNoteOpen] = createSignal(false)
  const [note, setNote] = createSignal("")

  const top = () => Math.max(8, props.rect.top - 44)
  const left = () => Math.min(Math.max(8, props.rect.left), window.innerWidth - 220)

  const submitNote = () => {
    const text = note().trim()
    if (!text) return
    props.onNote(text)
  }

  return (
    <div class="fixed z-50 flex flex-col gap-1" style={{ top: `${top()}px`, left: `${left()}px` }}>
      <div
        class="flex items-center gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg"
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <IconButton
          icon={<Icon name="bubble-5" size="small" />}
          size="small"
          variant="ghost"
          aria-label="Quote"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.onQuote()
          }}
        />
        <button
          type="button"
          class="rounded px-2 py-1 text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            setNoteOpen((value) => !value)
          }}
        >
          + Note
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.onCancel()
          }}
        >
          ✕
        </button>
      </div>
      <Show when={noteOpen()}>
        <div class="flex items-center gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-1 shadow-lg">
          <input
            autofocus
            value={note()}
            onInput={(event) => setNote(event.currentTarget.value)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submitNote()
              }
              if (event.key === "Escape") {
                event.preventDefault()
                props.onCancel()
              }
            }}
            placeholder="Add a note…"
            class="w-48 rounded border-0 bg-transparent px-2 py-1 text-13-regular text-v2-text-text-base outline-none"
          />
          <IconButton icon={<Icon name="arrow-up" size="small" />} size="small" variant="ghost" aria-label="Send" onClick={submitNote} />
        </div>
      </Show>
    </div>
  )
}