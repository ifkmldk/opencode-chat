import { createMemo, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { BasicTool } from "../../components/basic-tool"
import type { ToolProps } from "../../tools/tool-renderer"

// fork: the checklist the model keeps with todo_write. Each call carries the whole list, so the card renders from the
// call input (available while the tool is still running) and shows progress plus the item in flight in its title row.

type Status = "pending" | "in_progress" | "completed"
type Item = { content: string; status: Status; activeForm?: string }

const STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"])

export function todoItems(input: Record<string, unknown>): Item[] {
  const value = input.todos
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Item[] => {
    if (!entry || typeof entry !== "object") return []
    const item = entry as Record<string, unknown>
    if (typeof item.content !== "string" || !item.content) return []
    const status = typeof item.status === "string" && STATUSES.has(item.status) ? (item.status as Status) : "pending"
    return [{ content: item.content, status, activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined }]
  })
}

export function TodoToolOutput(props: ToolProps) {
  const i18n = useI18n()
  const items = createMemo(() => todoItems(props.input))
  const done = createMemo(() => items().filter((item) => item.status === "completed").length)
  const active = createMemo(() => {
    const current = items().find((item) => item.status === "in_progress")
    return current ? (current.activeForm ?? current.content) : undefined
  })
  const subtitle = createMemo(() =>
    [i18n.t("ui.tool.todo.progress", { done: done(), total: items().length }), active()].filter(Boolean).join(" · "),
  )
  return (
    <BasicTool
      {...props}
      icon="bullet-list"
      hasContent={items().length > 0}
      defaultOpen={false}
      trigger={{ title: i18n.t("ui.tool.todo.title"), subtitle: subtitle() }}
    >
      <ul class="flex flex-col gap-1.5 p-3" data-component="todo-card">
        <For each={items()}>
          {(item) => (
            <li class="flex items-start gap-2 text-13-regular" data-status={item.status}>
              <span class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                <Show
                  when={item.status === "completed"}
                  fallback={
                    <span
                      class="size-2.5 rounded-full border"
                      classList={{
                        "border-text-weak": item.status === "pending",
                        "border-icon-info-base bg-icon-info-base": item.status === "in_progress",
                      }}
                    />
                  }
                >
                  <Icon name="circle-check" size="small" />
                </Show>
              </span>
              <span
                classList={{
                  "text-text-weak line-through": item.status === "completed",
                  "text-text-strong": item.status === "in_progress",
                  "text-text-base": item.status === "pending",
                }}
              >
                {item.status === "in_progress" ? (item.activeForm ?? item.content) : item.content}
              </span>
            </li>
          )}
        </For>
      </ul>
    </BasicTool>
  )
}
