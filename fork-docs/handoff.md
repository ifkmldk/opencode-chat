# OpenCode fork — handoff (rewritten 2026-09-26, replaces 2026-09-23 Claude Code handoff)

> Old 2026-09-23 handoff archived at `C:\Users\fadhi\opencode-app\handoff.md.bak-2026-09-26`.
> It is obsolete: it describes an ephemeral `Temp\claude\...\scratchpad` checkout,
> `packages/opencode/dist` deploy, and `service start` launcher. Do not follow it.
> This document is the current truth. Everything below was verified with
> `git log/status` on `C:\Users\fadhi\opencode-dev`, branch `custom/main`.

**Read this whole document before touching anything.**

> **2026-09-28 update:** the v1 UX was restored on top of this in branch `v1-ux-restore` (see §8). §8 replaces
> the "do NOT port back" list in §2 and the deploy steps in §5. The detailed hook map and rebase recipe are in
> `C:\Users\fadhi\opencode-dev\FORK-HOOKS.md`.

## 0. Where the work lives (permanent, not ephemeral)

- Permanent checkout: `C:\Users\fadhi\opencode-dev`, branch `custom/main`.
- HEAD: `ed3752886f` — `feat(chat): view-mode E2E, attachment pipeline E2E, artifact gallery, 429 fallback docs`
  (previous: `bacae2d595` voice/prompt-library/history; `3a6b043593` workflow
  templates; `76a5d2943c` fork CI + env example; `514c972b54` research workspace
  filters + workflow E2E, tagged `v2-chat-alpha`).
- Working tree state: clean (`git status --short` empty) at time of writing.
- Upstream remote: `origin https://github.com/anomalyco/opencode.git`.
- Fork remote: `fork git@github-pribadi:ifkmldk/opencode-chat.git` (SSH alias,
  verified `ssh -T git@github-pribadi` → `Hi ifkmldk!`). Push BLOCKED:
  repo `ifkmldk/opencode-chat` does not exist yet (`git ls-remote fork HEAD` →
  `ERROR: Repository not found.`; also probed `opencode`, `opencode-dev`,
  `opencode-fork`, `opencode-chat-fork`, `opencode-app` — none exist; public
  repos are only `bwa-invid, hr-analytics, ifkmldk.github.io,
  learning-projects, retail-analytics`).
  Owner must create empty private repo `opencode-chat` under `ifkmldk`
  (no README), then: `git push fork custom/main:main` + `git push fork v2-chat-alpha`.
  Exact commands (already configured, just run after creating the repo):
  `cd C:\Users\fadhi\opencode-dev; git push fork custom/main:main; git push fork v2-chat-alpha; git ls-remote fork`.
  Decision: fork repo's `main` = this `custom/main` history (linear, simplest).
- Handoff file: `C:\Users\fadhi\opencode-app\handoff.md` (this file).

## 1. What this project is

Source fork of `opencode` (Solid.js web/desktop frontend + Effect-TS backend),
from `https://github.com/anomalyco/opencode`, `dev` branch lineage.
Daily use: chat, attach (correct MIME), chat quote, Canvas crop to model,
browser region capture to composer, research panel to Chat (web-search fallback),
read-only maps/jobs/action cards, image/PPTX/PDF preview on desktop.

### Monorepo layout (v2, current — not the v1 paths in the old handoff)

- `packages/app` — Solid.js frontend (web + Electron renderer). Scripts:
  `typecheck` (`tsgo -b`), `typecheck:e2e` (`tsgo -p e2e/tsconfig.json`),
  `test:unit` / `test:browser` (bun+happydom), `test:e2e` (playwright),
  `build` (`vite build`), `serve` (`vite preview`).
  Deps include `pptx-preview 1.0.7`, `mammoth`, `xlsx 0.18.5`, `@zip.js/zip.js`.
- `packages/session-ui` — shared session-rendering components (`app -> session-ui -> ui`).
  Must NOT import from `packages/app`. Shared contract lives here:
  `packages/session-ui/src/tools/research-events.ts`.
- `packages/ui` — base UI primitives.
- `packages/server` (`@opencode/server`), `packages/cli` (`@opencode/cli`),
  `packages/core` — backend/CLI. CLI dev entry:
  `bun run --cwd packages/cli src/index.ts`.
- `packages/desktop` (`@opencode/desktop`, Electron):
  `dev` (`bun ./scripts/dev.ts`), `build` (`electron-vite build`),
  `package:win` (`electron-builder --win`).

### Key files for the v2 chat work

- `packages/session-ui/src/tools/research-events.ts` — `RESEARCH_ASK_CHAT_EVENT`,
  `researchSearchPrompt`, `shortlistPrompt`, `draftActionPrompt`,
  `removeShortlistPrompt`, `mapEmbedUrl`, `routeEmbedUrl`, `formatRouteMeta`.
- `packages/app/src/session/screen.tsx:75` — `ResearchAskChatListener` (prefills composer).
- `packages/app/src/session/files/session-research-panel.tsx` — Research workspace
  panel (query + category + location + budget).
- `packages/app/src/settings/general/research-providers.tsx` +
  `research-provider-fields.ts` — read-only provider endpoint helper.
- `packages/desktop/src/main/windows/appearance.ts:41` + `early.ts:60` —
  `plugins: true` (desktop PDF viewer).
- `packages/app/src/session/files/artifact-view.tsx` — PPTX client-side via `pptx-preview`.

## 2. What's DONE on custom/main (verified via git log)

~~Intentional v2 divergences — do NOT port back~~ — **superseded 2026-09-28, see §8.** The v1 iframe + proxy
ticket browser (for the web UI) and the v1 annotation cards (composer and sent bubble) were ported back on
purpose. The desktop native browser pane and region capture (`1e6069876a,69e08b89e4,aefff2080c,d0c29a888a,495b650a4a`)
stay as they are. LibreOffice is still not ported; `pptx-preview` client-side (`a6f58a3e2a`, locked `e0004a84fb`)
remains the PPTX renderer.

v2 chat stack (oldest -> newest on custom/main):

- `5435d3fadf` durable approval-gated action tool (+ `156c036086,ffd4daf781,f8e163bed3` hardening).
- `78aa4bc0fd,bd2101560a,ec067a390d,f6f79a2fc7,237f0b8e89` read-only OSM maps +
  jobs provider + bounded place search.
- `5a636c4d8b` explainable local CV matching; `5cf98bcb04,9cb30ab4bc`
  Laya classifier runtime + workspace panel; `68973fc709,3a91254e52,3daf1dd6d5,1835a93000`
  research candidates UI + provider status + web-search fallback.
- `47b1039c9f` fix(composer): preserve binary MIME for mentioned files
  (was Bug 1 in `reflective-floating-chipmunk.md`).
- `b686fcc332,c76f1ec63e,b8624a9ede,d450e119de` Canvas tab + region selection +
  chat quote + desktop PDF `plugins:true` + canvas E2E.
- `a6f58a3e2a,e0004a84fb` PPTX visual client-side + dep lock.
- `cf12daf5fc` interactive research shortlist, maps embeds, PDF text bridge:
  OSM iframe read-only, Shortlist/Draft/Remove buttons only prefill composer
  via `RESEARCH_ASK_CHAT_EVENT` (model executes; permission + approval intact),
  `screen.tsx:75` listener, dep-free PDF text extract + Send to Chat.
- `236f058dc9` provider settings helper: inputs for `OPENCODE_*_API_URL` +
  webhook, URL validation, rejects credentials, export block output.
  Read-only (never writes `process.env`).
- `42eed697a4,45e9f2900a` shortlist E2E (ask-chat prefill, candidate ID).
- `514c972b54` (HEAD, tagged `v2-chat-alpha`): research workspace filters
  (query+category+location+budget via shared `researchSearchPrompt`) +
  3-step workflow E2E green.

### Last green validation (2026-09-26, this machine)

- `bun test src/tools/research-events.test.ts` (session-ui): 4 pass.
- `bun run typecheck:e2e` (app): EXIT 0. `typecheck` app + session-ui: EXIT 0.
- `playwright test e2e/user-story/research-shortlist.spec.ts --reporter=line`:
  `1 passed (22.9s)`.

## 3. Honest NOT-DONE list

- Live structured providers: code supports `OPENCODE_JOBS/HOTEL/FLIGHT/PRODUCT/
  YOUTUBE/PLACE/EVENT/COURSE_API_URL` + `OPENCODE_ACTION_WEBHOOK`
  (see `research-provider-fields.ts`), but env is empty on all machines ->
  always web-search fallback. Not live.
- Native Laya on Windows: impossible (`laya.ts` native is darwin+arm64 only).
  Realistic = deterministic honest fallback, can be disabled. Do not promise native.
- Desktop visual E2E: Playwright web only. Electron `plugins:true` set, but no
  clipboard-image / browser-pane-native spec yet.
- PDF OCR scan: text extraction only; scanned PDFs are just an `mcp-pdf` hint.
- PPTX LibreOffice: intentionally NOT ported; `pptx-preview` client-side is the
  correct Windows direction. LibreOffice server-side is optional, not default.
- Usable daily for: chat, correct-MIME attach, chat quote, Canvas crop -> model,
  browser region -> composer, research panel -> Chat (fallback web),
  read-only maps/jobs/action, desktop image/PPTX/PDF preview.
  Not yet seamless like ChatGPT/Claude/Gemini for: interactive maps, 1-click
  shortlist without typing, no-restart provider settings, 1-click OCR,
  booking workflow with clear approval.

## 4. 9Router + fork safety rules

- E2E uses the mock server; never burns 9Router quota
  (`muse-spark`, proxy `127.0.0.1:20128`).
- Fork rules: do NOT change id `9router`/`opencode-9router`; do NOT add `pdf`
  to modalities until the proxy provably forwards PDF; do NOT commit
  `~/.config/opencode/opencode.json` (contains a live apiKey).

## 5. Deploy v2 (replaces old §5)

> For the 4096 Start Menu launcher, use the deploy steps in §8. The installed CLI exe is what the launcher
> runs, and it must be built with `OPENCODE_CHANNEL=custom/main` so it keeps using the owner's database.

- Web/app: `bun run --cwd packages/app build` then `serve`
  (`vite build` / `vite preview`). No `packages/opencode/dist` path anymore.
- Desktop: `bun --cwd packages/desktop build` then `package:win`
  (`electron-builder --win --config electron-builder.config.ts`).
- CLI/server dev: `bun run --cwd packages/cli src/index.ts`.
  No `service start` launcher line; use `serve` semantics.
- The old port-4096 globally-installed `@opencode/cli` binary story no longer
  applies to this checkout; redeploy from the commands above.
- Never test against the owner's real live session/data: use isolated
  `opencode serve` on a spare port + disposable project dir + fresh origin
  (`127.0.0.1` vs `localhost` vs LAN IP share `localStorage`, so use a truly
  fresh origin). Read-only checks on the real instance are fine.

## 6. Roadmap

Fase 0 DONE (this session): spec reorder fix -> E2E 1 passed ->
commit `514c972b54` -> tag `v2-chat-alpha` -> this rewrite.

Fase 1 (local items DONE, push BLOCKED — repo `ifkmldk/opencode-chat` belum
dibuat; remote `fork git@github-pribadi:ifkmldk/opencode-chat.git` sudah
dikonfigurasi, SSH `Hi ifkmldk!` OK):
`76a5d2943c` adds `.github/workflows/fork-chat.yml` (typecheck app+session-ui+e2e,
unit research-events, 1-spec Playwright, triggers on `custom/main` AND `main`
so it fires whether the fork default is `custom/main` or `main`; follow-up
`63ece5055c`) — separate
from upstream `check.yml`/`test.yml` (dev/v2 only, untouched). `.env.example`
lists all 9 research envs with empty values (source of truth:
`research-provider-fields.ts`). `pptx-preview` pinned `1.0.7`
(`packages/app/package.json` + `bun.lock`); `html2canvas` is NOT used anywhere
in the repo, so nothing to pin. Remaining: owner creates empty private repo
`opencode-chat` under `ifkmldk` (no README), then
`git push fork custom/main:main` + `git push fork v2-chat-alpha`
(tag still sits on `514c972b54`, three commits behind HEAD —
push as-is; it marks the workflow milestone, not the CI commits).

Fase 2 (ChatGPT/Gemini parity) PARTIALLY DONE in `3a6b043593` (green):
per-category workflow templates = `RESEARCH_CATEGORY_HINTS` per kategori +
non-blocking `validateResearchFilters` (location hint untuk hotel/flight/place/
event/job/service, budget-contains-number) + hint/warning UI di panel
(`data-action="research-hint"/"research-warning"`) + E2E step-1 asserts hint,
warning, lalu warning hilang setelah location+budget valid; maps ringan =
`placeOpenUrl` (prefer provider URL, fallback lat/lon, tolak
non-http scheme) + `routeDirectionsUrl`, place/route `ResultCard` sekarang
link `Open` ke OSM eksternal; approval-card wiring = Shortlist/Draft/Remove
sudah prefill via `RESEARCH_ASK_CHAT_EVENT`, permission + approval tetap di
model (tidak ada eksekusi langsung dari tombol).
Validation: unit 5 pass, typecheck app+session-ui+e2e EXIT 0,
E2E `research-shortlist.spec.ts` 1 passed (23.8s).
Remaining Fase 2: PDF text-layer SUDAH ADA (extract + Send to Chat; OCR hanya
hint MCP — tidak diubah sesi ini); desktop smoke PARTIALLY DONE (`plugins.test.ts`
smoke guard `plugins: true` di `appearance.ts` + `early.ts`, unit 1 pass —
full Electron window smoke tetap `skipIf(CI)`, benar karena runner CI
tidak ada display); Leaflet TIDAK DIPERLUKAN (OSM embed + link cukup).

Fase 3 (differentiation) PARTIALLY DONE in `bacae2d595` (green):
voice input = `composer/voice.ts` (Web Speech only, no server;
`voiceRecognitionCtor` reuse `getSpeechRecognitionCtor` dari
`session/terminal/runtime-adapters.ts`, `appendVoiceTranscript` pure) +
`ComposerVoiceButton` mic di `data-slot="composer-actions"` (hidden penuh
di host tanpa SpeechRecognition) + icon `mic` + i18n `prompt.action.voice*`
+ `addVoiceTranscript` di interaction (append + focus) + unit `voice.test.ts`
2 pass; prompt library = `RESEARCH_PROMPT_TEMPLATES` (4 template, body reuse
`researchSearchPrompt` agar wording tidak drift) + tombol `data-action=
"research-template"` prefill composer, E2E assert template click → prefill;
research history = `load/add/save/clearResearchHistory` (localStorage
`opencode.research.history`, max 20, dedup query+category, best-effort) +
panel simpan tiap Ask + section recent-5 + Clear, E2E assert history muncul
setelah submit; artifact gallery = BELUM (tidak ada kode gallery; butuh
definisi: daftar preview yang dibuka vs galeri generated — pending keputusan
owner); offline 9Router→Zen 429 = BELUM (websearch sudah ada cooldown+random
429; tidak ada string 9router/muse-spark di codebase; aturan fork tetap).
Validation: unit research-events 6 pass, voice 2 pass, plugins 1 pass,
typecheck app+session-ui+desktop+e2e EXIT 0, E2E `research-shortlist.spec.ts`
1 passed (23.3s).

Fase 3 sisa (done in `ed3752886f`, green — push tetap di akhir sesuai instruksi):
view-mode toggle = SUDAH ADA di v2 (`view-mode-control.tsx` + `view-mode.ts` +
`timeline/controller.tsx:107-127` + `settings/model.tsx:10,85`), sisa kerjaan
hanya verifikasi → spec baru `view-mode-toggle.spec.ts` 1 passed (21.7s:
cycle chat→code→laya, persist reload, `data-mode` assert). Attachment
pipeline = MIME path v2 `composer/request.ts:69` `artifactMime()` `47b1039c9f`
+ unit pass + spec baru `attachment-verify.spec.ts` 1 passed (18.7s, isolated
mock, tidak sentuh port-4096). Artifact gallery = DONE session-only:
`add/removeArtifactGalleryEntry` + `artifactGalleryKind` (unit 1 test baru) +
`open-artifact.tsx` record tiap `open()` + panel section "Recently opened
previews" (`data-action="research-gallery"`, klik = reopen, max 8 tampil /
max 12 simpan, tanpa persist/thumbnail). 429 fallback = TERDOKUMENTASI JUJUR:
`core/websearch.ts:190-209` loop + cooldown `retry-after`/`cooldownMillis`
sudah ada + `websearch.test.ts` cover failover/random/cooldown (`fails over
on rate limits`, `respects Retry-After`, `fails promptly when all cooling`);
`zenmux.ts` hanya header patch, bukan fallback chain; tidak ada kode 9router/
muse-spark/modalities di repo (aturan fork tetap: jangan ganti id, jangan
tambah pdf modalities).

## 7. Working agreements (carry over, still true)

- `packages/session-ui` cannot import from `packages/app`; redeclare
  structurally-compatible types instead.
- Check mirrored/duplicate code blocks (V1/legacy vs V2/current, two composer
  call sites) — update both.
- `bun` here is `C:\Users\fadhi\AppData\Roaming\npm\node_modules\bun\bin\bun.exe`
  (the `bun.ps1` shim breaks piped/redirected runs; call `bun.exe` directly).
  PowerShell has no `tail`/`head`; use `Select-Object -Last/-First`.
- Commands: unit `bun test <file> --cwd <pkg>`; e2e typecheck
  `bun run --cwd packages/app typecheck:e2e`; spec
  `bun x playwright test e2e/user-story/research-shortlist.spec.ts --reporter=line`
  from `packages/app`.

- E2E lesson learned: assert Shortlist AND Draft prefill BEFORE submit;
  after submit the timeline re-renders and the held card locator goes stale
  (this was the step-3 timeout; fixed by reorder in `514c972b54`).

## 8. v1 UX restore on v2 (branch `v1-ux-restore`, 2026-09-28)

The owner wanted the v1.18.32 fork UX (branch `backup-v1-hotfix` = `c4523a59a2`) back on the v2 base, while
keeping every chat-stack feature from §2 and fixing its bugs. The work is on branch `v1-ux-restore` in
`C:\Users\fadhi\opencode-dev` (from `custom/main` `ed3752886f`). **It is uncommitted until the owner approves
commits.** WIP snapshots: `refs/wip/v1-ux-phase{2..6}`, `refs/wip/v1-ux-verify`, `refs/wip/v1-ux-file-cards`,
and the latest, `refs/wip/v1-ux-launcher` (restore one with `git stash apply <sha>`).

`C:\Users\fadhi\opencode-dev\FORK-HOOKS.md` maps every upstream file the fork touches and why. It also lists
the upstream tests that were adapted, and has the rebase recipe for new v2 tags. Read it before rebasing.

### What is in it

- **Restored from v1:**
  - **Composer:** the Chat/Code/Laya dropdown, where the mode survives the first send and a reload.
  - **Timeline:** Chat mode keeps result cards (maps, jobs, research, sources, actions) visible.
  - **Annotations:** the unified annotator (region and text) on previews (image, video, CSV, markdown, PDF,
    office), Canvas, and the browser. Quotes, page text, and region captures show as cards in the composer
    and in the sent bubble.
  - **Web Browser pane:** iframe via `/api/experimental/browser-proxy` with single-use tickets. The desktop app
    keeps its native pane.
  - **Side panel:** side chat (a child session with the main chat as context), and the v1 "+" menu order.
  - **Home:** Topics, with side chats nested under their parent session.
  - **Settings:** opens as a dialog.
  - **Look:** markdown callouts (`> [!NOTE]` and the other types), the 800px conversation column, the grey
    bubble for local sessions (worktree sessions keep the accent), and system-font message text.
  - **Projects:** automatic avatar colours.
- **Chat-stack fixes:**
  - **Styling and controls:**
    - Undefined CSS tokens replaced.
    - The mic only shows when voice input works.
    - The ✕ on context cards is visible.
    - Research/Canvas tabs can be closed and dragged.
  - **Behaviour:**
    - Research prefill inserts into the draft instead of replacing it.
    - PDF text is extracted with pdf.js.
    - The browser pane no longer uses `window.prompt` polling.
  - **Code quality:**
    - All strings are i18n.
    - Lint error in the stream probe fixed.
  - **Regression from `d76687ea35`:** expanded tools collapsed after switching tabs (found by bisect;
    tests `session-timeline-cache`, `subagent-child-navigation`).
- **Browser-proxy security:**
  - Every proxy request needs a single-use ticket bound to its URL.
  - Proxied pages always run in a CSP sandbox (opaque origin). Without this, a page opened through the proxy
    could run script as the opencode origin. The web UI authenticates with HTTP Basic, which the browser caches.
  - Private, loopback, and special-use targets are blocked on every redirect hop, including IPv4-mapped IPv6
    such as `[::ffff:127.0.0.1]`.
  - 60s fetch timeout and 25MB cap. Tests: `packages/server/test/browser-proxy.test.ts`.
- **File cards (2026-09-29):** each reply ends with one strip of Claude-style cards for the files it produced:
  icon/thumbnail, name, "Document · PDF", a Download button, and click opens the side-panel preview.
  - Sources, across every step of the turn: links, `write`/`patch` results, inline code, and bare Windows or
    relative paths. Implicit sources only count for output-like types, so code edits don't make cards.
  - Only files that exist get a card. Download is byte-exact, so zip, docx and large files no longer save empty.
  - The model is told to link the files it creates (built-in instruction `core/output-files`). Existing
    sessions get one "instructions updated" entry.
  - Code: `session-ui/src/message/assistant-artifact*.ts(x)`, `app/src/fork/artifact-download.ts`.
    E2E: `app/e2e/user-story/artifact-cards.spec.ts`.
- **Launcher start-up fixes (2026-09-29):** the owner saw an IDM "download this file" popup and the browser's
  "Sign in" dialog at every start, and a black terminal window during web search.
  - **IDM popup:** the service worker precached the 26 notification sounds as `.aac` files, and IDM grabs
    those requests. Sounds are now inlined as data URIs (`app/src/shell/notifications/sound.ts`), so the build
    has no audio files; they still play.
  - **Sign-in dialog:** the launcher opened the app without a token. It now reads the password from
    `~/.config/opencode/service.json` (never printed or logged) and opens `--app=http://127.0.0.1:4096/?auth_token=…`.
    The app keeps the token in `sessionStorage` for that window (`app/src/fork/auth-token.ts`), so F5 and
    service-worker updates stay signed in; a new window without the token still asks for the password.
  - **Black terminal on web search:** it came from the owner's plugins, not from opencode. `opencode-websearch`
    auto-starts SearXNG (`python -m searx.webapp`) with `detached: true`. On Windows that starts the venv
    launcher with no console, so the real interpreter gets a new, visible console window. `opencode-preview`
    had the same bug for dev servers (`cmd` → `node`). Both now spawn attached on Windows (`windowsHide` then
    gives them an invisible console). Reproduced before and verified after with a window watcher. The
    `creationFlags` option they passed does not exist in Node or Bun.
  - **Playwright MCP:** `--headless` added in `~/.config/opencode/opencode.json`, so web research no longer
    opens a Chromium window.
  - Backups of every file changed outside the repo: `C:\Users\fadhi\opencode-app\backups\2026-09-29\`
    (`opencode-app.ps1`, `opencode.json`, `plugins\opencode-websearch\index.ts`, `plugins\opencode-preview\index.ts`).
- **Freeze on open (2026-09-29, after the deploy):** the owner's app window showed the session header and
  composer, an empty timeline, and took no input at all (not even F12).
  - Found with Brave started through `opencode-app.ps1 -DebugPort 9229` and a raw CDP trace. The renderer ran
    528k forced layouts and 40k `scrollTo` calls in microtasks.
  - Cause: the owner's site zoom is 75% on 125% scaling, so `devicePixelRatio` is 0.9375. The timeline asked
    to scroll to 2016px, but the browser stops at 2014.93 (one device pixel is 1.07 CSS px). Upstream's
    cold-bottom settle (`session/timeline/virtualizer.tsx`) only accepts a 1px gap, so it retried forever.
  - Fixed with a device-pixel tolerance, a spin guard, and a 3s reveal fallback (see FORK-HOOKS.md).
  - Verified by simulating the unreachable end: the old UI froze and the fixed UI rendered.
  - Headless tests never saw it, because Playwright's `deviceScaleFactor` does not reproduce real page zoom.
- **Windows build fix:** the web UI CSP hashed the inline theme-preload script with CRLF line endings.
  Browsers hash it after normalizing to LF, so every Windows build (including the one running on 4096)
  blocked that script. It is now hashed like browsers do. Test: `packages/cli/test/web-ui.test.ts`.
- **Kept as v2 on purpose,** because upstream tests encode them as design decisions:
  - The "Used N Read, Grep" tool-group label; v1 said "Explored 1 read".
  - The model variant picker, which only shows "Default" on hover.
- **Known limits:**
  - PDF and HTML region capture asks for screen-share permission (`getDisplayMedia`).
  - DNS rebinding isn't prevented by the proxy check.
  - LibreOffice is not ported.

### Verification (2026-09-28)

- **Typecheck:** clean in app (plus `typecheck:e2e`), ui, session-ui, protocol, client, server, and cli.
- **Lint:** `bun run lint` reports 0 errors.
- **Unit tests:** all pass.
  - ui: 113
  - session-ui: 208
  - app: 934 unit (1 skip) and 157 browser
  - server: 10 in `test/browser-proxy.test.ts`
- **E2E, full suite:** 468 of 477 passed (including the new `artifact-cards` spec in Code and Chat mode). Run from `packages/app`, mock API only:
  `PLAYWRIGHT_PORT=3107 PLAYWRIGHT_SERVER_PORT=4998 node node_modules/@playwright/test/cli.js test`.
  - 8 failures are `mobile-timeline-scroll` "detached session gestures". They fail the same way on pristine
    upstream `v2.0.15` in local dev mode, so they are inherited and not fork bugs.
  - 1 was a load flake (`terminal-composer-focus` on 2026-09-29, `session-summary-layout` rtl the run before), which
    then passed every repeat (21 of 21 and 18 of 18).
- **Launcher fixes (2026-09-29):**
  - Unit tests: app 938 (1 skip) and 157 browser; app typecheck clean. The app build has no audio files.
  - Smoke test of the new exe on port 4207 (isolated):
    - The token sign-in, F5, and a fresh window (asks again) all behave as designed.
    - The precache has 895 entries and no audio. The sound preview plays from a data URI.
    - A `shell` tool call opens no window.
  - Full E2E: 464 of 477 passed. 8 failures are the inherited `mobile-timeline-scroll` ones. The other 5 are
    dev-server load flakes, not caused by these changes:
    - 2 passed on rerun.
    - 3 (`session-summary` tooltip ×2, `composer-command-draft`) render an empty session view while vite
      serves about 700 unbundled modules to 4 parallel workers. With 4 repeats each, they fail at the same rate
      with today's two app files reverted (8 of 12 against 9 of 12).
    - Against the production build (`PLAYWRIGHT_BUILD=1`), 11 of 12 passed; the one failure was a tooltip hover.
- **Same 19 spec files on Cline's `custom/main`:** 17 failures, 9 of them from the chat layer. All 9 are fixed:
  - One-click "Open file" (5): Cline made the "+" a menu.
  - Tab order in `prompt-thinking-level`.
  - `session-timeline-cache` (2) and `subagent-child-navigation`: regression from commit `d76687ea35`.
- **QA harness** (`C:\Users\fadhi\opencode-qa-uxdiff`): side-by-side against the v1 exe. `shots/before-after.png`
  shows the session, "+" menu, settings, and home. A missing @mentioned file shows the toast "Unable to read
  attachment" and keeps the draft; no file is substituted.
- **Benchmark** (`bun run bench:tabs`, production build, 20 samples per scenario): four runs in counterbalanced
  order, Cline → fork → Cline → fork. The machine drifted about 20% slower over the hour.
  - Warm tab switches are consistently faster on the fork. First correct paint: 64 and 95 ms, versus 111 and
    128 ms on Cline's build. This is likely the `timelineDetail` memo fix.
  - Cold switches are within noise (±6%).
  - No regression.
  - File cards (2026-09-29): same four-run order, before vs after the feature. Every pair is within ±3%
    (warm 64.7 vs 66.3 ms and 82.3 vs 85.0 ms; cold 345.7 vs 340.9 ms).

### Deploy (replaces §5 for the 4096 launcher)

The launcher runs `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe serve --port 4096`. That exe's
channel is `custom/main`, and **the channel picks the data files**: `~/.local/share/opencode/opencode-custom-main.db`
and `~/.config/opencode/service-custom-main.json`. Build with the same channel. A build from branch
`v1-ux-restore` would open a new, empty `opencode-v1-ux-restore.db`.

```powershell
cd C:\Users\fadhi\opencode-dev\packages\cli
$env:OPENCODE_CHANNEL = "custom/main"; & "C:\Users\fadhi\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" script/build.ts --single --skip-install
# output: packages\cli\dist\cli-windows-x64\bin\opencode.exe
```

Do not pass `--skip-web-ui`: it embeds an empty UI archive. The exe is then about 179 MB instead of about
207 MB and serves no UI. Before deploying, smoke-test the new exe in isolation. `C:\Users\fadhi\opencode-qa-uxdiff\smoke-exe.ps1`
runs it on port 4206 with its own HOME/XDG dirs and the mock LLM, so the owner's DB is never touched.

Then:

1. Back up the installed exe as `opencode.exe.bak-<date>` next to it.
2. Stop 4096 with `opencode-app.ps1 -Stop`.
3. Copy the new exe in.
4. Start the Start Menu launcher.

The app window may show the old UI until its service worker refreshes: reload once or twice. To roll back,
copy the backup exe back and restart.

If a smoke server is still running from `packages\cli\dist`, its exe is locked and the build fails with
`EPERM` on `rm dist`. Build elsewhere with `--outdir=<folder>` instead.

**Plugin fix 2026-09-30 10:52:** `~/.config/opencode/plugins/opencode-preview/canvas-server.ts` no longer hangs
when two projects start the canvas at once. A failed `listen` on 51230 left `ensureCanvas` pending forever, so
`canvas_list` and `artifact_list` froze the turn. The loser now reuses the running canvas. The backup is
`backups/2026-09-29/opencode-preview-canvas-server.ts.bak`.

**Fase 1 audit selesai 2026-10-05 (`2.0.15-fork.8`, belum di-push):** lihat CHANGELOG-FORK. Berikutnya Fase 2: mesin
dokumen (skill docx/pptx/xlsx/pdf + render-lalu-periksa lewat LibreOffice, template), lalu Fase 3 paritas agen
(todo, mode izin, katalog tool, hook, sandbox). Rencana lengkap: C:/Users/fadhi/.claude/plans/reflective-floating-chipmunk.md.

### Progress snapshot 2026-09-30 09:21 (deployed `0.0.0-custom/main-202609300218`, WIP ref `refs/wip/v1-ux-maps`)

**Done since the Maps plan (all uncommitted on `v1-ux-restore`):**

- **Canvas and previews**
  - Canvas and preview tools open in a side-panel web tab.
  - PDFs render with pdf.js.
- **IDM**
  - File reads use `/api/fs/read/~b64~<base64url>` with `application/octet-stream`, so IDM stops grabbing previews.
  - `%2E` escaping was not enough, because IDM decodes it.
- **Chat**
  - `[[OPENCODE_TASK_COMPLETE]]` is hidden in chat.
- **Settings**
  - Settings → Maps loads without suspending the app (no black screen).
  - The Research providers block is collapsed and points to Maps.
  - An open window offers a "new version, Reload" toast after deploys.
- **Maps**
  - Only free data sources are used; the owner chose this after Google refused 2.5 Flash and Flash-Lite for their key.
  - Tools: search, route, matrix, POI, geo_compute (+ classify, Moran's I, Gi*, NNI, centrography) and map_show.
  - A 429-exhausted day skips Google until the reset.
  - Research place, hotel and event queries go through Maps, and the Laya fallback follows a spatial ranking.
- **Map UI**
  - Map tab in the side panel with numbered pins and name chips, plus a bottom card strip.
  - Gemini-style inline place cards in replies: photo, stars, open status.
  - Photo carousel in tool cards.

**Open items / ideas:**

- Wikimedia photo coverage for Indonesian places is low (1 of 7 in BSD); a category icon is the fallback.
- No Google ratings without a paid API.
- Dedupe the 14 plugin SDK copies to speed up the first project load. This needs the owner's OK.
- Nothing is committed yet. Snapshot refs: `refs/wip/v1-ux-launcher`, `v1-ux-freeze-fix`, `v1-ux-maps`.

**Deployed 2026-09-30 (later):** a window that stays open now finds new builds by itself (on focus / every 10 min)
and shows "A new version of OpenCode is ready → Reload". The Map tab opens on the first maps result of a turn, and
place cards no longer carry map thumbnails. The window that was open since 2026-09-29 17:06 still ran the
pre-Maps UI and had to be closed once by hand. Previous exe: `opencode.exe.prev-0025`.

**Deployed 2026-09-30:** research place/hotel/event now come from Maps, a Gemini 429 stops Google for the rest
of the Pacific day, and the Research providers block is collapsed with a pointer to Settings → Maps. Live check
on 2026-09-30 of the free OSM services (Nominatim, Photon, OSRM, Overpass): all OK. Google is untested until the
owner adds a free-tier key. Previous exe: `opencode.exe.prev-1534`.

**Deployed 2026-09-29 22:43:** `0.0.0-custom/main-202609291534`. Maps: Settings → Maps (Gemini free-tier key,
never billed; OpenStreetMap fallback), place/route cards, `place:` chips, Leaflet Map tab, spatial statistics in
`geo_compute`, and a Laya fallback that follows a spatial ranking. Guide for the owner: `maps-gratis.md`. QA used
mocks only (`opencode-qa-uxdiff/mock-geo.ts` on 4298 and the `petakan` scenario in `mock-llm.ts`); no live
Google or OSM calls. Previous exe: `opencode.exe.prev-1507`.

**Deployed 2026-09-29 22:11:** `0.0.0-custom/main-202609291507`. IDM no longer grabs PDF previews (file reads
use `report%2Epdf` and come back as `application/octet-stream`), and `[[OPENCODE_TASK_COMPLETE]]` is hidden
in chat (the runner still sees it). Previous exe: `opencode.exe.prev-1450`.

**Deployed 2026-09-29 21:52:** `0.0.0-custom/main-202609291450`. Canvas output (opencode-preview and
opencode-artifacts tools, also inside Code Mode `execute`) now opens in a side-panel browser tab instead of a new
browser window, and PDFs preview in the panel (pdf.js pages with zoom). The plugins no longer launch a browser:
`~/.config/opencode/plugins/opencode-preview/helpers.ts` `openUrl` only does so with
`OPENCODE_PREVIEW_OPEN_BROWSER=1`, and `/canvas` asks the model to call `canvas_open` (backups in
`backups6-09-29\opencode-preview-{helpers,index}.ts.bak*`). The previous exe is `opencode.exe.prev-1410`.

**Deployed 2026-09-29 21:14:** `0.0.0-custom/main-202609291410` (adds the fix for the black screen when scrolling up to older file cards, plus the maps backend). Earlier on 16:43: `0.0.0-custom/main-202609290939` (v1 UX, file cards, launcher fixes, freeze fix)
is the installed exe. Next to it are the two earlier exes:
- Cline's `0.0.0-custom/main-202609250927` as `opencode.exe.bak-2026-09-29`
- the 11:33 build, which froze at 75% zoom, as `opencode.exe.prev-0424`

After a deploy, a window that is still open keeps running the old UI from its service worker. Close every
OpenCode window, then reopen it from the launcher. `opencode-app.ps1 -DebugPort 9229` starts Brave with remote
debugging, but only when Brave is not already running. Close Brave completely afterwards so the port closes. The launcher started the server ("Server ready"), 4096 serves the new
`index.html`, and the launcher's credentials are accepted.

To roll back:

1. `opencode-app.ps1 -Stop`.
2. In `%APPDATA%\npm\node_modules\@opencode\cli\bin`, rename `opencode.exe` to `opencode.exe.new` and
   `opencode.exe.bak-2026-09-29` to `opencode.exe`.
3. Optionally copy `backups\2026-09-29\opencode-app.ps1` back (the token change also works with the old exe).
4. Start the launcher.

**Slow first load after a server start (pre-existing):** each of the 14 plugins in
`~/.config/opencode/plugins` has its own `node_modules` with its own copy of `@opencode/plugin` 2.0.3 and
`effect` 4.0.0-rc.112. The first project opened after a start imports every copy on the main thread, and the
server answers nothing (not even 401s) until that finishes: about 90 s on 2026-09-26, about 5 min on
2026-09-29 while the E2E suite loaded the machine. Later projects load their plugins in milliseconds.
Deduplicating those two packages into one shared copy would remove most of it (not done; it changes the
owner's plugin folders).
