import type { MarkedExtension, Tokens } from "marked"

// fork: GitHub-style alert blocks (v1). `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and
// `[!CAUTION]` render as colored callouts instead of a plain blockquote. Models already write this
// syntax, so no bespoke markup is needed.
type CalloutType = "note" | "tip" | "important" | "warning" | "caution"

const ICONS: Record<CalloutType, string> = {
  note: `<path d="M7.91683 7.91927V6.2526H12.0835V8.7526L10.0002 10.0026V12.0859M10.0002 13.7526V13.7609M17.9168 10.0026C17.9168 14.3749 14.3724 17.9193 10.0002 17.9193C5.62791 17.9193 2.0835 14.3749 2.0835 10.0026C2.0835 5.63035 5.62791 2.08594 10.0002 2.08594C14.3724 2.08594 17.9168 5.63035 17.9168 10.0026Z" stroke="currentColor" stroke-linecap="square"/>`,
  tip: `<path d="M12.4987 7.91732L8.7487 12.5007L7.08203 10.834M17.9154 10.0007C17.9154 14.3729 14.371 17.9173 9.9987 17.9173C5.62644 17.9173 2.08203 14.3729 2.08203 10.0007C2.08203 5.6284 5.62644 2.08398 9.9987 2.08398C14.371 2.08398 17.9154 5.6284 17.9154 10.0007Z" stroke="currentColor" stroke-linecap="square"/>`,
  important: `<path d="M7.49935 9.3737L9.16602 11.0404L12.4994 7.70703M9.99935 2.08203L17.0827 4.3737V9.92565C17.0827 14.0694 13.3327 16.2487 9.99935 18.047C6.66602 16.2487 2.91602 14.0694 2.91602 9.92565V4.3737L9.99935 2.08203Z" stroke="currentColor" stroke-linecap="square"/>`,
  warning: `<path d="M10 7.91667V11.6667M10 13.7417V13.75M10 2.5L1.875 16.25H18.125L10 2.5Z" stroke="currentColor" stroke-linecap="square"/>`,
  caution: `<path d="M15.3675 4.63087L4.55742 15.441M17.9163 9.9987C17.9163 14.371 14.3719 17.9154 9.99967 17.9154C7.81355 17.9154 5.83438 17.0293 4.40175 15.5966C2.96911 14.164 2.08301 12.1848 2.08301 9.9987C2.08301 5.62644 5.62742 2.08203 9.99967 2.08203C12.1858 2.08203 14.165 2.96813 15.5976 4.40077C17.0302 5.8334 17.9163 7.81257 17.9163 9.9987Z" stroke="currentColor" stroke-linecap="round"/>`,
}

const START = /^ {0,3}>[ \t]*\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i
const LINE = /^ {0,3}>[ \t]?(.*)(?:\r?\n|$)/

function match(src: string) {
  const start = src.match(START)
  if (!start) return
  const lines = collect(src.slice(start[0].length))
  return {
    type: start[1].toLowerCase() as CalloutType,
    raw: start[0] + lines.raw,
    body: lines.body.join("\n"),
  }
}

// Consume the blockquote's continuation lines; the callout ends at the first line without `>`.
function collect(rest: string, raw = "", body: string[] = []): { raw: string; body: string[] } {
  const line = rest.match(LINE)
  if (!line || !line[0]) return { raw, body }
  return collect(rest.slice(line[0].length), raw + line[0], [...body, line[1]])
}

export const calloutExtension: MarkedExtension = {
  extensions: [
    {
      name: "callout",
      level: "block",
      tokenizer(src) {
        const found = match(src)
        if (!found) return
        const token: Tokens.Generic = { type: "callout", raw: found.raw, calloutType: found.type, tokens: [] }
        this.lexer.blockTokens(found.body, token.tokens!)
        return token
      },
      renderer(token) {
        const type = token.calloutType as CalloutType
        const body = this.parser.parse(token.tokens ?? [])
        return `<div data-callout="${type}"><div data-callout-icon><svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">${ICONS[type]}</svg></div><div data-callout-body>\n${body}</div></div>\n`
      },
    },
  ],
}
