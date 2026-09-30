import { FileSystem } from "@opencode/core/filesystem"
import { RelativePath } from "@opencode/core/schema"
import { FileNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const file = yield* fs
            .read({
              path: RelativePath.make(readPath(new URL(ctx.request.url, "http://localhost").pathname.slice(13))),
            })
            .pipe(
              Effect.mapError(
                (error) => new FileNotFoundError({ path: error.path, message: `File not found: ${error.path}` }),
              ),
            )
          // fork: script reads (fetch) get plain bytes; a PDF or archive MIME type made download managers (IDM)
          // take over the request. The app never renders this response by its type.
          const script = ctx.request.headers["sec-fetch-dest"] === "empty"
          return HttpServerResponse.uint8Array(file.content, { contentType: script ? "application/octet-stream" : file.mime })
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
      .handle("fs.write", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.write({ path: ctx.query.path, data: ctx.payload })
          }),
        ),
      )
  }),
)

// fork: the app sends "~b64~<base64url>" so the URL never names the file (download managers hijack those);
// plain percent-encoded paths still work for other clients.
function readPath(segment: string) {
  if (!segment.startsWith("~b64~")) return decodeURIComponent(segment)
  return Buffer.from(segment.slice(5), "base64url").toString("utf8")
}
