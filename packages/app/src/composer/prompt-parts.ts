import type { ContentPart, ImageAttachmentPart, PathAttachmentPart, Prompt } from "./state"

/** Parts that sit beside the text rather than inside it. */
export function isAttachment(part: ContentPart): part is ImageAttachmentPart | PathAttachmentPart {
  return part.type === "image" || part.type === "path"
}

export function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

/** Add text to a draft without discarding what the user already typed or attached. */
export function appendDraftText(prompt: Prompt, text: string): Prompt {
  const next: Prompt = [{ type: "text", content: text, start: 0, end: text.length }]
  if (!prompt.some((part) => part.type !== "text" || part.content.trim())) return next
  return appendPrompt(prompt, next)
}

export function appendPrompt(prompt: Prompt, following: Prompt): Prompt {
  const start = promptLength(prompt)
  const offset = start + 2
  return [
    ...clonePrompt(prompt),
    { type: "text", content: "\n\n", start, end: offset },
    ...clonePrompt(following).map((part) =>
      isAttachment(part) ? part : { ...part, start: part.start + offset, end: part.end + offset },
    ),
  ]
}
