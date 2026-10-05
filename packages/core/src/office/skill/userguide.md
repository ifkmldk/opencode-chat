# User guide from a website or app (.pptx)

Use when the user asks for a user guide, tutorial, SOP, training deck or "how to" for a website or web app ("buatkan user guide web A dengan tema B", "cara pakai fitur perf review di H5"). Read the `office-design` and `pptx` skills too.

## 1. Plan the guide before touching the browser

- Who reads it (employee, manager, admin), the goal (finish one task), and the exact flow: list the steps as short imperatives ("Buka menu Performance", "Pilih siklus Q4", "Isi self review", "Kirim").
- Theme: the user's theme name maps to a palette and font pair (see office-design); if they named brand colours, use them as the accent.
- Language: the user's language for every slide.

## 2. Capture each step with `web_browser`

- Open the start page: `web_browser({ url, screenshot: "viewport" })`. Look at the screenshot.
- For each step: highlight the element the reader must use, then screenshot, then do the action:
  `web_browser({ steps: [{ do: "highlight", target: "Performance" }], screenshot: "viewport" })`
  `web_browser({ steps: [{ do: "clear-highlight" }, { do: "click", target: "Performance" }], screenshot: "none" })`
- Keep the PNG path of every screenshot (printed as "Screenshot saved: ..."). Never invent a screen you did not capture.
- Look at every screenshot before using it: it must show the screen that step describes (a step "open the job detail" needs the detail page, not the list), with the frame on the right element. If not, navigate or highlight again and take a new one. One screenshot per step; never reuse one screenshot for two steps.
- Highlight only the one element the reader must use in that step; frames from earlier calls are cleared automatically.
- If the page needs a login or shows an "are you human" check (`needsUser`), stop: ask the user to sign in in the Browser panel or to share screenshots, or to let you use a demo/sandbox account. Never type passwords.
- An internal app on a private address is blocked by default; the owner can allow it with `OPENCODE_FETCH_ALLOW_HOSTS=<host>`.
- Do not capture other people's personal data: if a screen shows names, salaries or ratings of real people, tell the user and offer to use a test account or blur.

## 3. Build the deck with the office kit

```js
import { createDeck } from "file:///{{KIT}}/deck.mjs"

const deck = createDeck({ title: "Panduan Performance Review", palette: "midnight", fonts: "modern", footer: "HR · Panduan pengguna" })
deck.cover({ kicker: "PANDUAN PENGGUNA", title: "Mengisi Performance Review Q4", subtitle: "Untuk karyawan · 6 langkah", meta: "Versi Oktober 2026" })
deck.timeline({ title: "Alur singkat", steps: [{ label: "Buka", text: "Menu Performance" }, { label: "Pilih", text: "Siklus Q4" }, { label: "Isi", text: "Self review" }, { label: "Kirim", text: "Ke atasan" }] })
deck.step({ number: 1, title: "Buka menu Performance", image: "C:/.../shot-1.png", actions: ["Klik Performance di menu kiri", "Pilih tab My Review"], tip: "Menu ini muncul setelah siklus dibuka HR." })
deck.step({ number: 2, title: "Pilih siklus Q4 2026", image: "C:/.../shot-2.png", actions: ["Klik kartu Q4 2026", "Periksa tenggat di kanan atas"] })
deck.content({ title: "Pertanyaan umum", bullets: ["Bisa disimpan sebagai draf sebelum dikirim", "Setelah dikirim, hubungi atasan untuk membuka kembali"] })
await deck.save("out/panduan-performance-review.pptx")
```

- One step per slide (`step`): number, title in imperative, the screenshot (shown whole), 1-4 actions, optional tip. Overview, FAQ and contact slides use `timeline`, `content`, `table` or `closing`.
- Write every action from what the screenshot shows (button names exactly as on screen).

## 4. Check and deliver

- `office_render` the deck and look at every slide: screenshot readable, highlight visible, text not clipped, numbers in order. Fix and render again.
- End with a link to the .pptx. Offer a PDF copy (render once more) if the user wants to share it.
