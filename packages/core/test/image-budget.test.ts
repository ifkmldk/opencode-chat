import { expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import { ImageBudgetPlugin } from "../src/plugin/image-budget"

test("only the latest image-bearing tool result keeps its images", () => {
  const shot = (id: string) =>
    Message.tool({ id, name: "web_browser", result: [{ type: "text", text: "page" }, { type: "file", uri: "data:image/jpeg;base64,AAAA", mime: "image/jpeg", name: `${id}.jpg` }], resultType: "content" })
  const messages = [Message.user("buat user guide"), shot("a"), shot("b"), shot("c")]
  const hook = ImageBudgetPlugin.__test.trim
  hook(messages)
  const images = messages.map((message) => JSON.stringify(message).includes("data:image"))
  expect(images).toEqual([false, false, false, true])
  expect(JSON.stringify(messages[1])).toContain("image already shown earlier")
})
