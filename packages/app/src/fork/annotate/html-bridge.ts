// fork: text and code annotation for the HTML preview. The preview iframe is a sandboxed blob (opaque origin), so the
// app cannot read its selection; a small script injected into the previewed HTML reports it by postMessage, the same
// way the Browser pane's proxy bridge does (server/src/handlers/browser-proxy.ts).

export const SELECTION_MESSAGE = "opencodeArtifactSelection"
export const CLEAR_MESSAGE = "opencodeArtifactClear"
const TEXT_CAP = 4000
const HTML_CAP = 2000

const BRIDGE = `(function(){var post=function(m){try{parent.postMessage(m,"*")}catch(e){}};
var t;document.addEventListener("selectionchange",function(){clearTimeout(t);t=setTimeout(function(){
var s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;var text=s.toString();if(!text.trim())return;
var r=s.getRangeAt(0),el=r.commonAncestorContainer;el=el.nodeType===1?el:el.parentElement;var b=r.getBoundingClientRect();
post({${SELECTION_MESSAGE}:{text:text.slice(0,${TEXT_CAP}),html:el?el.outerHTML.slice(0,${HTML_CAP}):"",rect:{x:b.left,y:b.top,width:b.width,height:b.height}}})},150)});
document.addEventListener("mousedown",function(){post({${SELECTION_MESSAGE}:null})});
addEventListener("message",function(e){if(e.data&&e.data.${CLEAR_MESSAGE}){var s=getSelection();if(s)s.removeAllRanges()}});
})();`

/** The HTML with the selection bridge as its first script. Pages without a head get one. */
export function injectSelectionBridge(html: string) {
  const script = `<script>${BRIDGE}</script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}${script}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${script}</head>`)
  return `<head>${script}</head>${html}`
}

export type FrameSelection = { text: string; html?: string; rect: { x: number; y: number; width: number; height: number } }

/** The selection a bridge message reports (null = cleared), or undefined when the message is not for this frame. */
export function readSelectionMessage(data: unknown): FrameSelection | null | undefined {
  if (!data || typeof data !== "object" || !(SELECTION_MESSAGE in data)) return undefined
  const value = (data as Record<string, unknown>)[SELECTION_MESSAGE]
  if (value === null) return null
  if (!value || typeof value !== "object") return undefined
  const { text, html, rect } = value as { text?: unknown; html?: unknown; rect?: Record<string, unknown> }
  if (typeof text !== "string" || !text.trim() || !rect) return undefined
  const number = (key: string) => (typeof rect[key] === "number" && Number.isFinite(rect[key]) ? (rect[key] as number) : 0)
  return {
    text: text.slice(0, TEXT_CAP),
    html: typeof html === "string" && html ? html.slice(0, HTML_CAP) : undefined,
    rect: { x: number("x"), y: number("y"), width: number("width"), height: number("height") },
  }
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const GAP = "(?:\\s|<[^>]*>|&nbsp;)+"

/** The source lines (1-based, inclusive) that hold the selected text, matching through tags and whitespace. */
export function sourceLines(source: string, selected: string) {
  const words = selected.split(/\s+/).filter(Boolean)
  if (!words.length) return undefined
  const run = (list: string[]) => new RegExp(list.map(escape).join(GAP))
  const head = run(words.slice(0, 6)).exec(source)
  if (!head) return undefined
  const tail = run(words.slice(-6))
  const after = source.slice(head.index)
  const end = tail.exec(after)
  const endIndex = end ? head.index + end.index + end[0].length : head.index + head[0].length
  const line = (index: number) => source.slice(0, index).split("\n").length
  return { start: line(head.index), end: line(Math.max(head.index, endIndex - 1)) }
}
