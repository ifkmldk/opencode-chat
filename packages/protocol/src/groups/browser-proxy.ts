import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, InvalidRequestError } from "../errors.js"

// fork: web Browser pane. The desktop app renders pages in a native view; a browser tab cannot, so the
// web UI frames pages through this server-side proxy instead.
export const BROWSER_PROXY_TICKET_QUERY = "ticket"
export const BROWSER_PROXY_TOKEN_HEADER = "x-opencode-ticket"
export const BROWSER_PROXY_TOKEN_HEADER_VALUE = "1"

// fork: also the HTML preview page route, which is framed with its own ticket the same way.
const BROWSER_PROXY_PATH = /^\/api\/experimental\/browser-proxy(?:\/preview)?$/

// Authorization middleware skips credential checks when this matches: an iframe cannot send
// credentials, so the proxy handler consumes and validates the single-use ticket instead.
export function hasBrowserProxyTicketURL(url: URL) {
  return BROWSER_PROXY_PATH.test(url.pathname) && !!url.searchParams.get(BROWSER_PROXY_TICKET_QUERY)
}

export const BrowserProxyTicket = Schema.Struct({
  ticket: Schema.String,
  expiresIn: Schema.Number,
}).annotate({ identifier: "BrowserProxyTicket" })

export const BrowserProxyGroup = HttpApiGroup.make("server.browserProxy")
  .add(
    HttpApiEndpoint.post("browserProxy.ticket", "/api/experimental/browser-proxy/ticket", {
      payload: Schema.Struct({ url: Schema.String }),
      headers: Schema.Struct({ [BROWSER_PROXY_TOKEN_HEADER]: Schema.optional(Schema.String) }),
      success: BrowserProxyTicket,
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "browserProxy.ticket",
        summary: "Create Browser proxy ticket",
        description:
          "Create a short-lived, single-use ticket that lets the web Browser pane frame one public http(s) URL through the proxy.",
      }),
    ),
  )
  .add(
    // Query fields are read by the raw handler; the ticket replaces credentials for iframe requests.
    HttpApiEndpoint.get("browserProxy.proxy", "/api/experimental/browser-proxy", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html" })),
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "browserProxy.proxy",
        summary: "Fetch a page for the Browser pane",
        description:
          "Fetch a public http(s) URL server-side and strip framing restrictions so the web Browser pane can show it.",
        transform: (operation) => ({
          ...operation,
          parameters: [
            ...(operation.parameters ?? []),
            ...["url", BROWSER_PROXY_TICKET_QUERY].map((name) => ({ in: "query", name, schema: { type: "string" } })),
          ],
        }),
      }),
    ),
  )
  .add(
    // fork: HTML file previews. The app's CSP blocks inline and CDN scripts in blob: frames, so the preview HTML is
    // parked here and framed from this route, which serves it with only a sandbox directive.
    HttpApiEndpoint.post("browserProxy.preview", "/api/experimental/browser-proxy/preview", {
      payload: Schema.Struct({ html: Schema.String }),
      headers: Schema.Struct({ [BROWSER_PROXY_TOKEN_HEADER]: Schema.optional(Schema.String) }),
      success: BrowserProxyTicket,
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "browserProxy.preview",
        summary: "Stage an HTML preview",
        description: "Store one HTML document briefly and return a ticket that frames it at the preview route.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("browserProxy.previewPage", "/api/experimental/browser-proxy/preview", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html" })),
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "browserProxy.previewPage",
        summary: "Serve a staged HTML preview",
        description: "Serve a staged HTML document in an opaque-origin sandbox so its own scripts can run.",
        transform: (operation) => ({
          ...operation,
          parameters: [
            ...(operation.parameters ?? []),
            { in: "query", name: BROWSER_PROXY_TICKET_QUERY, schema: { type: "string" } },
          ],
        }),
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "browser-proxy", description: "Experimental proxy routes for the web Browser pane." }),
  )
