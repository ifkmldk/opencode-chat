export * as MapsErrors from "./error.js"

export type Kind = "unavailable" | "rate_limited" | "rejected" | "invalid_response" | "not_found" | "disabled"

// fork: one error shape for every maps backend (Gemini, Nominatim, Photon, OSRM, Overpass). Messages never
// contain API keys; the tool layer turns them into ToolFailure.
export class MapsError extends Error {
  readonly service: string
  readonly kind: Kind

  constructor(input: { service: string; kind: Kind; message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.service = input.service
    this.kind = input.kind
  }
}

export function isMapsError(error: unknown): error is MapsError {
  return error instanceof MapsError
}
