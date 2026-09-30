// Embedded PDF text via pdf.js, which handles compressed streams and font encodings that a raw
// byte scan cannot. Loaded lazily so the viewer only pays for it when text is requested.
export async function extractPdfText(bytes: Uint8Array, limit = 40_000) {
  const pdfjs = await import("pdfjs-dist")
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // pdf.js transfers the buffer to its worker; copy so the caller's bytes stay usable.
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  const total = doc.numPages
  const pages: string[] = []
  const state = { length: 0, truncated: false }
  for (const index of Array.from({ length: total }, (_, i) => i + 1)) {
    const page = await doc.getPage(index)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .trim()
    if (state.length + text.length > limit) {
      pages.push(text.slice(0, Math.max(0, limit - state.length)))
      state.truncated = true
      break
    }
    pages.push(text)
    state.length += text.length + 2
  }
  await task.destroy()
  return { text: pages.filter(Boolean).join("\n\n"), truncated: state.truncated, pages: total }
}
