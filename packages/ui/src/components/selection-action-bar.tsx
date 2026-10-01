import { createSignal, Show } from "solid-js"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "../context/i18n"

// Shared floating bar for every annotator surface (chat selection, Canvas, Browser, file previews):
// each surface computes its own rect and funnels Quote / + Note into the composer context.
export function SelectionActionBar(props: {
  rect: DOMRect
  /** fork: the captured text, shown above the note box so the user sees exactly what will be quoted. */
  preview?: string
  onQuote: () => void
  onNote: (text: string) => void
  onCancel: () => void
}) {
  const i18n = useI18n()
  const [noteOpen, setNoteOpen] = createSignal(false)
  const [note, setNote] = createSignal("")

  // fork: with the note box open the bar moves below the selection, so the highlighted quote stays readable.
  const top = () =>
    noteOpen()
      ? Math.max(8, Math.min(props.rect.bottom + 8, window.innerHeight - 220))
      : Math.max(8, props.rect.top - 44)
  const left = () => Math.min(Math.max(8, props.rect.left), window.innerWidth - 340)

  const submitNote = () => {
    const text = note().trim()
    if (!text) return
    props.onNote(text)
  }

  const button =
    "h-7 rounded-md px-2 text-12-medium text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"

  return (
    <div
      data-component="selection-action-bar"
      class="fixed z-50 flex flex-col gap-1"
      style={{ top: `${top()}px`, left: `${left()}px` }}
    >
      <div
        class="flex items-center gap-0.5 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1 shadow-[var(--v2-elevation-raised)]"
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <button
          type="button"
          data-action="selection-quote"
          class={`${button} flex items-center gap-1.5`}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.onQuote()
          }}
        >
          <Icon name="bubble-5" size="small" />
          {i18n.t("ui.selectionBar.quote")}
        </button>
        <button
          type="button"
          data-action="selection-note"
          class={button}
          aria-expanded={noteOpen()}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            setNoteOpen((value) => !value)
          }}
        >
          {i18n.t("ui.selectionBar.note")}
        </button>
        <IconButton
          icon={<Icon name="xmark-small" size="small" />}
          size="small"
          variant="ghost-muted"
          aria-label={i18n.t("ui.selectionBar.dismiss")}
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.onCancel()
          }}
        />
      </div>
      <Show when={noteOpen()}>
        <div class="flex w-80 flex-col gap-1 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1 shadow-[var(--v2-elevation-raised)]">
          <Show when={props.preview?.trim()}>
            {(text) => (
              <div
                data-slot="selection-preview"
                title={text()}
                class="mx-1 mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap border-s-2 border-v2-border-border-strong ps-2 text-12-regular text-v2-text-text-muted"
              >
                {text()}
              </div>
            )}
          </Show>
          <div class="flex items-center gap-1">
            <input
              autofocus
              data-action="selection-note-input"
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
              placeholder={i18n.t("ui.selectionBar.notePlaceholder")}
              class="min-w-0 flex-1 rounded border-0 bg-transparent px-2 py-1 text-13-regular leading-[var(--line-height-compact)] text-v2-text-text-base outline-none"
            />
            <IconButton
              icon={<Icon name="arrow-up" size="small" />}
              size="small"
              variant="ghost"
              aria-label={i18n.t("ui.promptInput.send")}
              onClick={submitNote}
            />
          </div>
        </div>
      </Show>
    </div>
  )
}
