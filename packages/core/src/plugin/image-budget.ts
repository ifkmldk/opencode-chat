export * as ImageBudgetPlugin from "./image-budget.js"

import { Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

// fork: screenshots and rendered pages are sent to the model as images, and every later request in the same turn sent
// them again. A user guide with eight rendered slides plus five screenshots reached the provider's request size limit
// ("413 Request Entity Too Large") and the turn died before its answer. Only the images of the latest tool result that
// carries images are sent now; older ones become a one-line note (the files themselves stay on disk).

const KEEP = 1

export const Plugin = define({
  id: "opencode.image-budget",
  effect: Effect.fn("ImageBudgetPlugin")(function* (ctx) {
    yield* ctx.session.hook("context", (event) => Effect.sync(() => trim(event.messages)))
  }),
})

function trim(messages: Message[]) {
  const carriers = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "tool" && message.content.some((part) => part.type === "tool-result" && hasImages(part.result)))
  carriers.slice(0, Math.max(0, carriers.length - KEEP)).forEach(({ message, index }) => {
    messages[index] = Message.make({
      role: "tool",
      content: message.content.map((part) =>
        part.type === "tool-result" && part.result.type === "content"
          ? { ...part, result: { type: "content" as const, value: part.result.value.map(withoutImage) } }
          : part,
      ),
    })
  })
}

const isImage = (item: Tool.Content) => item.type === "file" && item.mime.startsWith("image/")

const hasImages = (result: { readonly type: string; readonly value?: unknown }) =>
  result.type === "content" && (result.value as ReadonlyArray<Tool.Content>).some(isImage)

const withoutImage = (item: Tool.Content): Tool.Content =>
  item.type === "file" && isImage(item) ? { type: "text", text: `[image already shown earlier: ${item.name ?? "image"}]` } : item

export const __test = { trim }
