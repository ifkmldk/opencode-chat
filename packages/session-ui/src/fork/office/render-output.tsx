import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { BasicTool } from "../../components/basic-tool"
import { useMarkdown } from "../../context/markdown"
import type { ToolProps } from "../../tools/tool-renderer"

// fork: page strip for office_render. The model gets the page images in the tool result; this shows the same pages to the
// user. Images load by path through the markdown image reader (plain signals, never createResource, so a slow read cannot
// suspend the timeline).

type Page = { page: number; file: string }

export function renderPages(source: unknown): { engine?: string; pages?: number; files: Page[] } {
  if (!source || typeof source !== "object") return { files: [] }
  {
    const record = source as Record<string, unknown>
    const files = Array.isArray(record.files)
      ? record.files.flatMap((entry): Page[] => {
          if (!entry || typeof entry !== "object") return []
          const item = entry as Record<string, unknown>
          return typeof item.file === "string" && typeof item.page === "number" ? [{ page: item.page, file: item.file }] : []
        })
      : []
    return {
      engine: typeof record.engine === "string" ? record.engine : undefined,
      pages: typeof record.pages === "number" ? record.pages : undefined,
      files,
    }
  }
}

function Thumb(props: { page: Page }) {
  const markdown = useMarkdown()
  const [url, setUrl] = createSignal<string>()
  createEffect(() => {
    // The image reader only accepts drive paths written with forward slashes.
    const path = props.page.file.split(String.fromCharCode(92)).join("/")
    const read = markdown?.readImage
    setUrl(undefined)
    if (!read) return
    const controller = new AbortController()
    const state = { url: undefined as string | undefined }
    void read(path, controller.signal)
      .then((source) => {
        if (controller.signal.aborted || !source) return
        state.url = URL.createObjectURL(source)
        setUrl(state.url)
      })
      .catch(() => undefined)
    onCleanup(() => {
      controller.abort()
      if (state.url) URL.revokeObjectURL(state.url)
    })
  })
  return (
    <div class="flex w-40 shrink-0 flex-col gap-1" data-slot="office-render-page">
      <div class="flex h-24 items-center justify-center overflow-hidden rounded border border-border-weak-base bg-background-base">
        <Show when={url()}>{(src) => <img src={src()} alt="" class="max-h-full max-w-full object-contain" />}</Show>
      </div>
      <span class="text-11-regular text-text-weak">{props.page.page}</span>
    </div>
  )
}

export function OfficeRenderOutput(props: ToolProps) {
  const i18n = useI18n()
  const info = createMemo(() => renderPages(props.metadata))
  const name = createMemo(() => String(props.input.file ?? "").split(/[\/]/).pop() ?? "")
  const subtitle = createMemo(() =>
    [name(), info().pages !== undefined ? i18n.plural("ui.tool.officeRender.pages", info().pages ?? 0) : undefined, info().engine]
      .filter(Boolean)
      .join(" · "),
  )
  return (
    <BasicTool
      {...props}
      icon="photo"
      hasContent={info().files.length > 0}
      defaultOpen={info().files.length > 0}
      trigger={{ title: i18n.t("ui.tool.officeRender.title"), subtitle: subtitle() }}
    >
      <div class="flex gap-2 overflow-x-auto p-3" data-component="office-render-card">
        <For each={info().files}>{(page) => <Thumb page={page} />}</For>
      </div>
    </BasicTool>
  )
}
