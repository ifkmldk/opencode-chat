import type { FileSelection } from "@/workspaces/files/model"
import type { ContextItem } from "@/composer/schema"

/** fork: a quote or annotation the user staged; the sent message shows it as a card. */
export type PromptAnnotation = {
  kind: "quote" | "page-text" | "media"
  text?: string
  comment?: string
  source?: string
  role?: "user" | "assistant"
}

export function promptAnnotations(context: readonly ContextItem[]) {
  return context.flatMap((item): PromptAnnotation[] => {
    if (item.type === "file") return []
    const comment = item.comment?.trim() || undefined
    if (item.type === "message-quote") {
      const text = item.quotedText.trim()
      return text ? [{ kind: "quote", text, comment, role: item.role }] : []
    }
    if (item.type === "page-text-annotation")
      return [{ kind: "page-text", text: item.text, comment, source: item.sourceURL ?? item.sourcePath }]
    return [{ kind: "media", comment, source: item.surface === "browser" ? item.sourceURL : item.sourcePath }]
  })
}

function readAnnotations(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): PromptAnnotation[] => {
    if (!item || typeof item !== "object") return []
    const kind = (item as { kind?: unknown }).kind
    if (kind !== "quote" && kind !== "page-text" && kind !== "media") return []
    const text = (item as { text?: unknown }).text
    const comment = (item as { comment?: unknown }).comment
    const source = (item as { source?: unknown }).source
    const role = (item as { role?: unknown }).role
    return [
      {
        kind,
        text: typeof text === "string" ? text : undefined,
        comment: typeof comment === "string" ? comment : undefined,
        source: typeof source === "string" ? source : undefined,
        role: role === "user" || role === "assistant" ? role : undefined,
      },
    ]
  })
}

export type PromptComment = {
  path: string
  selection?: FileSelection
  comment: string
  preview?: string
  origin?: "review" | "file"
}

/** An attachment the model receives as a path on the server rather than inline bytes. */
export type PromptAttachmentReference = {
  name: string
  mime: string
  path: string
}

function selection(selection: unknown) {
  if (!selection || typeof selection !== "object") return undefined
  const startLine = Number((selection as FileSelection).startLine)
  const startChar = Number((selection as FileSelection).startChar)
  const endLine = Number((selection as FileSelection).endLine)
  const endChar = Number((selection as FileSelection).endChar)
  if (![startLine, startChar, endLine, endChar].every(Number.isFinite)) return undefined
  return {
    startLine,
    startChar,
    endLine,
    endChar,
  } satisfies FileSelection
}

export function createCommentMetadata(input: PromptComment) {
  return {
    opencodeComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
    },
  }
}

export function readCommentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { opencodeComment?: unknown }).opencodeComment
  if (!meta || typeof meta !== "object") return
  const path = (meta as { path?: unknown }).path
  const comment = (meta as { comment?: unknown }).comment
  if (typeof path !== "string" || typeof comment !== "string") return
  const preview = (meta as { preview?: unknown }).preview
  const origin = (meta as { origin?: unknown }).origin
  return {
    path,
    selection: selection((meta as { selection?: unknown }).selection),
    comment,
    preview: typeof preview === "string" ? preview : undefined,
    origin: origin === "review" || origin === "file" ? origin : undefined,
  } satisfies PromptComment
}

export function readPromptPresentation(value: unknown) {
  if (!value || typeof value !== "object") return
  const displayText = (value as { displayText?: unknown }).displayText
  const comments = (value as { comments?: unknown }).comments
  if (typeof displayText !== "string" || !Array.isArray(comments)) return
  const attachments = (value as { attachments?: unknown }).attachments
  return {
    displayText,
    annotations: readAnnotations((value as { annotations?: unknown }).annotations),
    attachments: (Array.isArray(attachments) ? attachments : []).flatMap((item): PromptAttachmentReference[] => {
      if (!item || typeof item !== "object") return []
      const name = (item as { name?: unknown }).name
      const mime = (item as { mime?: unknown }).mime
      const path = (item as { path?: unknown }).path
      if (typeof name !== "string" || typeof mime !== "string" || typeof path !== "string") return []
      return [{ name, mime, path }]
    }),
    comments: comments.flatMap((item): PromptComment[] => {
      if (!item || typeof item !== "object") return []
      const path = (item as { path?: unknown }).path
      const comment = (item as { comment?: unknown }).comment
      if (typeof path !== "string" || typeof comment !== "string") return []
      const preview = (item as { preview?: unknown }).preview
      const origin = (item as { origin?: unknown }).origin
      return [
        {
          path,
          comment,
          selection: selection((item as { selection?: unknown }).selection),
          preview: typeof preview === "string" ? preview : undefined,
          origin: origin === "review" || origin === "file" ? origin : undefined,
        },
      ]
    }),
  }
}

export function formatAttachmentReference(input: PromptAttachmentReference) {
  return `Attached file: \`${input.path}\``
}

export function formatCommentNote(input: { path: string; selection?: FileSelection; comment: string }) {
  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  return `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+)$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}
