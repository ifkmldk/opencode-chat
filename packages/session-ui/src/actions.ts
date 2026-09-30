import type { PromptFileAttachment } from "@opencode/client/promise"

export type SessionUserComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

/** fork: a quote or annotation the user sent with the message, shown as a card on the bubble. */
export type SessionUserAnnotation = {
  kind: "quote" | "page-text" | "media"
  text?: string
  comment?: string
  source?: string
  role?: "user" | "assistant"
}

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

export type SessionUserActions = {
  openAttachment?: (file: PromptFileAttachment) => void
  openArtifact?: (path: string) => void
  downloadArtifact?: (path: string) => void
  /** fork: which of these generated-file paths exist, so file cards only show real files. */
  artifactsExist?: (paths: string[]) => Promise<ReadonlySet<string>>
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}
