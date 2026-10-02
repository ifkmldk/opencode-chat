export type ClassifierEngine = "native" | "deterministic-fallback"

export type ClassifierAnswer = {
  readonly type: string
  readonly decision: string
  readonly confidence?: number
  readonly rationale?: string
}

export type RankedCandidate = {
  readonly id?: string
  readonly name?: string
  readonly score: number
}
