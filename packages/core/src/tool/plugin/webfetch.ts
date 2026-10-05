export * as WebFetchTool from "./webfetch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, type HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import { Permission } from "../../permission.js"
import { convertHTMLToMarkdown, MAX_MARKDOWN_BYTES } from "../html-markdown.js"
import { collectBoundedResponseBody } from "../http-body.js"

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = MAX_MARKDOWN_BYTES
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`

const Timeout = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("markdown" as const))),
  timeout: Schema.optionalKey(Timeout).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

const Output = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Input.fields.format,
  output: Schema.String,
})
type Format = (typeof Input.Type)["format"]

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

const headers = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const openCodeUserAgent =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OpenCode-User/1.0; +https://opencode.ai"

const isCloudflareChallenge = (error: HttpClientError.HttpClientError) => {
  if (error.reason._tag !== "StatusCodeError") return false
  const response = error.reason.response
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

/** The HTTP status when the failure looks like an anti-bot wall the scraper can try to get past. */
export const blockedStatus = (error: unknown) => {
  const reason = (error as { reason?: { _tag?: string; response?: { status?: number } } } | undefined)?.reason
  const status = reason?._tag === "StatusCodeError" ? reason.response?.status : undefined
  return status !== undefined && (status === 403 || status === 429 || status === 451 || status >= 500) ? status : undefined
}

/**
 * A page whose visible text is nearly empty although it is large and ships scripts: a client-rendered shell.
 * Small pages with a script tag (a short static page) are not shells.
 */
export const isEmptyShell = (html: string, contentType: string, converted: string) =>
  contentType.includes("text/html") && html.length >= 600 && converted.trim().length < 80 && /<script[\s>]/i.test(html)

const request = (url: string, format: Format, userAgent = openCodeUserAgent) =>
  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers(format, userAgent)))

const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
}

const execute = (http: HttpClient.HttpClient, url: string, format: Format, userAgent = openCodeUserAgent) =>
  http.execute(request(url, format, userAgent)).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))

const collectBody = (response: HttpClientResponse.HttpClientResponse) =>
  collectBoundedResponseBody(
    response,
    MAX_RESPONSE_BYTES,
    () => new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`),
  )

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"
const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

export const Plugin = {
  id: "opencode.tool.webfetch",
  effect: Effect.fn("WebFetchTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => assertHttpUrl(new URL(input.url)),
                catch: (error) => error,
              })

              yield* permission.assert({
                action: name,
                resources: [input.url],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })

              // fork: anti-bot walls (403/429/5xx) and empty JS shells go to the ultimate scraper (stealth tiers) instead of
              // failing, after the same permission check as scrape_fetch. The model got "Unable to fetch" for Traveloka.
              const viaScraper = (why: string) =>
                Effect.gen(function* () {
                  yield* permission.assert({
                    action: "scrape.fetch",
                    resources: [input.url],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                  const { UltimateScrape } = yield* Effect.promise(() => import("../../scrape/engine.js"))
                  const scraped = yield* UltimateScrape.run(http, {
                    url: input.url,
                    mode: "stealth",
                    format: input.format === "text" ? "text" : input.format === "html" ? "html" : "markdown",
                  })
                  if (!scraped.output.trim())
                    return yield* Effect.fail(new Error(`${why}; the scraper returned no content (${scraped.warnings.join("; ")})`))
                  const result = { url: input.url, contentType: "text/html", format: input.format, output: scraped.output }
                  return {
                    output: result,
                    content: `[fetched with the ${scraped.engine} scraper because the direct fetch was ${why}]

${result.output}`,
                    metadata: { contentType: result.contentType, engine: scraped.engine },
                  }
                })

              const fetched = yield* Effect.gen(function* () {
                const response = yield* execute(http, input.url, input.format).pipe(
                  Effect.catchIf(isCloudflareChallenge, () => execute(http, input.url, input.format, "opencode")),
                )
                const contentType = response.headers["content-type"] || ""
                const mime = mimeFrom(contentType)
                if (isImageAttachment(mime))
                  return yield* Effect.fail(new Error(`Unsupported fetched image content type: ${mime}`))
                if (!isTextualMime(mime))
                  return yield* Effect.fail(new Error(`Unsupported fetched file content type: ${mime}`))
                return { body: yield* collectBody(response), contentType }
              }).pipe(
                Effect.timeoutOrElse({
                  duration: Duration.seconds(input.timeout ?? DEFAULT_TIMEOUT_SECONDS),
                  orElse: () => Effect.fail(new Error("Request timed out")),
                }),
                Effect.result,
              )
              if (fetched._tag === "Failure") {
                const status = blockedStatus(fetched.failure)
                // fork: a transport error (TLS or handshake refusals of plain clients) is often fine for a real browser.
                if (status === undefined && /transport error/i.test(String((fetched.failure as Error)?.message ?? fetched.failure)))
                  return yield* viaScraper("unreachable by a plain HTTP client").pipe(
                    Effect.catch((error) =>
                      Effect.fail(
                        new Error(
                          `${(fetched.failure as Error)?.message ?? "Transport error"}; the browser fallback failed too (${error instanceof Error ? error.message : String(error)}). Say the site could not be reached instead of guessing.`,
                        ),
                      ),
                    ),
                  )
                if (status === undefined) return yield* Effect.fail(fetched.failure)
                return yield* viaScraper(`blocked with HTTP ${status}`).pipe(
                  Effect.catch((error) =>
                    Effect.fail(
                      new Error(
                        `HTTP ${status}: the site blocks plain fetches and the scraper fallback failed (${error instanceof Error ? error.message : String(error)}). Try scrape_fetch with mode "stealth", or another source.`,
                      ),
                    ),
                  ),
                )
              }
              const { body, contentType } = fetched.success
              const content = new TextDecoder().decode(body)
              const output = yield* Effect.try({
                try: () => convert(content, contentType, input.format),
                catch: (error) => error,
              })
              if (isEmptyShell(content, contentType, output)) {
                const escalated = yield* viaScraper("an empty page shell (content loads with JavaScript)").pipe(Effect.option)
                if (escalated._tag === "Some") return escalated.value
              }
              const result = {
                url: input.url,
                contentType,
                format: input.format,
                output,
              }
              return { output: result, content: result.output, metadata: { contentType: result.contentType } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to fetch ${input.url}`, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

export { convertHTMLToMarkdown }
