import { OfficeEngine } from "@opencode/core/office/engine"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Api } from "../api"

// fork: exact Office previews. Conversions run one at a time (Office automation is single-threaded) and finished
// previews are kept briefly by content hash, so reopening or switching tabs does not start Word again.
// Only Open XML files are accepted (zip signature checked, so a renamed binary file is refused): legacy binary formats
// can carry macros, and the automation scripts also run with macros disabled.

const MAX_BYTES = 40 * 1024 * 1024
const MAX_QUEUE = 4
const KEEP = 16
const ALLOWED = new Set(["docx", "pptx", "xlsx"])
const cache = new Map<string, { engine: string; pdf: string }>()
let queue: Promise<unknown> = Promise.resolve()
let waiting = 0

export const isOpenXml = (data: Uint8Array) => data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04

const convert = (name: string, data: Buffer) => {
  const key = createHash("sha256").update(path.extname(name).toLowerCase()).update(data).digest("hex")
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  waiting += 1
  const job = queue.then(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-preview-"))
    try {
      const file = path.join(directory, `document${path.extname(name).toLowerCase()}`)
      fs.writeFileSync(file, data)
      const result = await OfficeEngine.toPdf(file, path.join(directory, "out"))
      const value = { engine: result.engine, pdf: fs.readFileSync(result.pdf).toString("base64") }
      cache.set(key, value)
      while (cache.size > KEEP) cache.delete(cache.keys().next().value!)
      return value
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  const settle = () => {
    waiting -= 1
  }
  queue = job.then(settle, settle)
  return job
}

export const OfficeHandler = HttpApiBuilder.group(Api, "server.office", (handlers) =>
  Effect.succeed(
    handlers.handle(
      "office.preview",
      Effect.fn("OfficeHandler.preview")(function* (ctx) {
        const extension = path.extname(ctx.payload.name).slice(1).toLowerCase()
        if (!ALLOWED.has(extension))
          return yield* new InvalidRequestError({ message: "Only .docx, .pptx and .xlsx files can be previewed", kind: "office_type", field: "name" })
        const data = Buffer.from(ctx.payload.data, "base64")
        if (data.length === 0 || data.length > MAX_BYTES)
          return yield* new InvalidRequestError({ message: `File must be between 1 byte and ${MAX_BYTES / 1024 / 1024} MB`, kind: "office_size", field: "data" })
        if (!isOpenXml(data))
          return yield* new InvalidRequestError({ message: "The file is not a valid Open XML document", kind: "office_format", field: "data" })
        const kind = OfficeEngine.kindOf(ctx.payload.name)
        if (kind !== "docx" && kind !== "pptx" && kind !== "xlsx")
          return yield* new InvalidRequestError({ message: "Unsupported file type", kind: "office_type", field: "name" })
        if (OfficeEngine.available(kind).length === 0)
          return yield* new ServiceUnavailableError({ message: "No Office engine is installed on the server host", service: "office" })
        if (waiting >= MAX_QUEUE)
          return yield* new ServiceUnavailableError({ message: "Too many previews are being prepared; try again in a moment", service: "office" })
        return yield* Effect.tryPromise({
          try: () => convert(ctx.payload.name, data),
          catch: (error) => new ServiceUnavailableError({ message: error instanceof Error ? error.message : String(error), service: "office" }),
        })
      }),
    ),
  ),
)
