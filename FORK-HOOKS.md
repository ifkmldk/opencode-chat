# Fork hooks

This fork is upstream `opencode` **v2.0.15** (`6f3639d82e`) plus two layers:

1. **Chat stack** (`custom/main`, Cline, 62 commits): actions/maps/jobs/research tools, Laya classifier,
   research workspace, Canvas, office previews, voice, prompt library, artifact downloads.
2. **v1 UX restore** (`v1-ux-restore`): the v1.18.32 fork UX rebuilt on v2 (annotator, cards in the
   sent bubble, web Browser pane via server proxy, side chat, Topics, Chat/Code/Laya dropdown,
   settings dialog, callouts, v1 look). It also fixes bugs in layer 1.

Rebasing onto a newer upstream tag should only conflict in the upstream files listed below. Fork code
lives in its own files and upstream edits are kept small. The tables are the source of truth; the larger
v1 hooks also carry a `fork:` comment.

## Fork-owned files (no upstream counterpart, never conflict)

| Area | Files |
| --- | --- |
| v1 annotator | `packages/app/src/fork/annotate/{capture.ts,region-select.tsx,text-select.tsx}` |
| Web Browser pane | `packages/app/src/fork/web-browser/{model.ts,pane.tsx,tab.ts}` (loopback URLs are framed directly, not through the proxy, with `allow-same-origin` unless the port is the app's own), `canvas.ts` (+ test) and `canvas-listener.tsx` (a canvas tool from the opencode-preview/opencode-artifacts plugins that finishes during the turn, directly or inside Code Mode `execute`, opens its `http://localhost:<port>/#/<id>` page in a side-panel tab; watches the last assistant message, not tool cards, which remount when they finish), `packages/protocol/src/groups/browser-proxy.ts`, `packages/server/src/handlers/browser-proxy.ts` (+ `test/browser-proxy.test.ts`) |
| Side chat | `packages/app/src/fork/side-chat/{model.ts,pane.tsx,tab.ts}` |
| Topics | `packages/app/src/fork/topics/{model.ts,row.tsx}` |
| v1 look | `packages/app/src/fork/fork.css`, `packages/session-ui/src/fork/fork.css`, `packages/app/src/fork/avatar-color.ts` |
| Markdown callouts | `packages/ui/src/context/marked-callout.ts` |
| Chat-mode result cards | `packages/session-ui/src/timeline/result-tools.ts` |
| Generated-file cards (existence check and thumbnail use plain signals, never `createResource`: a resource read in the timeline suspends the whole session view and blanked the screen when an older turn with cards scrolled into view) | `packages/session-ui/src/message/assistant-artifact-model.ts` (`turnArtifacts`: links, `write`/`patch` results, inline code and bare paths across the turn) and `assistant-artifacts.tsx` (Claude-style card), `packages/app/src/fork/artifact-download.ts` (byte-exact download, existence check by folder listing), `packages/app/e2e/user-story/artifact-cards.spec.ts` |
| Maps & spatial analysis | core `maps/{geo,stats,links,error,osm,google,usage,settings,search,enrich}.ts` (enrich: free OSM facts — hours/open now, hotel stars, phone, website — and photos from OSM image/Commons/Wikipedia/Wikidata links or a Commons search whose title names the place and its area; Nominatim prefers POIs) (search: key + free-quota guard + OSM fallback shared by maps_search and research_search; a Gemini 429 marks the Pacific day exhausted) (stats: classify with GVF-based method choice, Moran's I, Gi*, Clark–Evans, centrography), `tool/plugin/maps.ts` (maps_search/ask/route/matrix/poi, geo_compute, map_show), `tool/plugin/laya.ts` fallback follows a `ranking` in the state; protocol `groups/maps.ts`, server `handlers/maps.ts`; session-ui `fork/places/{map-events.ts,maps-output.tsx,inline-cards.ts}` (tool-card photo carousel; Gemini-style cards after the first `place:` link of each place, via `MarkdownProvider.resolvePlace`; exports `./map-events`, `./place-cards`); app `fork/map/{scene,model,listener,pane}.ts(x)` + `map.css` (Leaflet Map tab, `leaflet` dep), `settings/maps/maps.tsx`; tests `core/test/maps/*`, `core/test/laya-spatial.test.ts`, `app/src/fork/map/scene.test.ts`. Owner guide: `opencode-app/maps-gratis.md` |
| Deploy pickup | `packages/app/src/fork/sw-update.tsx`: checks `/sw.js` on focus, visibility and every 10 min; a waiting build shows a persistent "new version" toast whose Reload posts `SKIP_WAITING`, and every window reloads on `controllerchange`. Hooked in `entry.tsx` (register → `watchServiceWorker`) and `shell/shell.tsx` (`<ServiceWorkerUpdate />`) |
| Chat quotes | `packages/app/src/session/chat-selection.tsx` follows the latest selection (a paused drag used to freeze the quote at its first word), keeps it while the note box has focus, and paints it with the CSS Custom Highlight `opencode-quote` (`app/src/fork/fork.css`). `ui/src/components/selection-action-bar.tsx` takes an optional `preview` and moves below the selection while the note is open; the composer chip (`composer/editor/editor.tsx`) shows the quoted text with the full quote and note on hover |
| Completion marker | `packages/session-ui/src/message/completion-marker.ts` (+ test): hides the runner's `[[OPENCODE_TASK_COMPLETE]]` (and a partial one while streaming) from assistant text and its copy; hooked in `message/message-content.tsx` `AssistantTextContent` |
| PDF preview | `packages/app/src/fork/pdf/pdf-pages.tsx`: pdf.js canvases, lazy per page, fit-width zoom. Chromium's viewer showed nothing in the app's blob frames |
| PDF text | `packages/app/src/workspaces/files/pdf-text.ts` (pdf.js, `pdfjs-dist` in `packages/app/package.json`) |
| Launcher sign-in | `packages/app/src/fork/auth-token.ts` (+ test): keeps the launcher's `?auth_token=` in `sessionStorage` for the window, so reloads and service-worker updates never show the Basic-auth dialog |
| Chat stack | `packages/core/src/tool/plugin/{action,jobs,laya,maps,research}.ts`, `packages/core/src/session/runner/completion.ts`, `packages/session-ui/src/tools/research-events.ts`, `packages/session-ui/src/message/assistant-artifact*.ts(x)`, `packages/app/src/session/files/{canvas-pane,session-research-panel}.tsx`, `packages/app/src/session/{chat-selection.tsx,view-mode.ts}`, `packages/app/src/composer/{view-mode-control.tsx,voice.ts}`, `packages/app/src/settings/general/research-provider*.ts(x)`, `packages/ui/src/components/selection-action-bar.tsx` |

## Upstream files with fork hooks

The "Layer" column says who owns the hook: **chat** is layer 1, **v1** is layer 2.

### Server, protocol, client, CLI

| File | Layer | Hook |
| --- | --- | --- |
| `protocol/src/api.ts` | v1 | registers `BrowserProxyGroup` |
| `protocol/src/client.ts` | v1 | `server.browserProxy` group name; raw `browserProxy.proxy` left out of generated clients |
| `server/src/handlers.ts` | v1 | registers `BrowserProxyHandler` |
| `server/src/middleware/authorization.ts`, `server/src/process.ts` | v1 | a ticketed `GET /api/experimental/browser-proxy` skips credential checks; the handler consumes the single-use ticket |
| `session-ui/src/components/markdown.tsx`, `context/markdown.tsx` | maps | `decoratePlaces` pass after images; `resolvePlace` on the markdown context (app: `session/files/open-artifact.tsx` reads `mapState.place`) |
| `session-ui/src/components/markdown-cache.tsx` | maps | `[Name](place:<id>)` becomes `a[data-place-ref]` (the app's `MapListener` handles the click) |
| `session-ui/src/tools/tool-renderer.tsx` | maps | maps_search/route/poi/map_show render `fork/places/maps-output.tsx` (the OSM iframe renderer is gone) |
| `app/src/session/{helpers.ts,files/session-side-panel.tsx,screen.tsx}` | maps | `MAP_TAB` ("map") tab, "+" menu item and pane; `MapListener` mounted with the screen |
| `app/src/settings/{surface.tsx,pages.ts,shell.tsx,search-catalog.ts}` | maps | Settings → Maps tab (server group). `settings/maps/maps.tsx` loads status with signals, never `createResource` (a slow first status blanked the whole app) |
| `core/src/tool/plugin/research.ts` | maps | place/hotel/event without `OPENCODE_<CAT>_API_URL` search Maps first (`placeCandidate`), web search only when Maps finds nothing |
| `app/src/settings/general/research-providers.tsx` | maps | block titled "Custom research endpoints (advanced, optional)", fields hidden behind "Show endpoints", note + link to Settings → Maps |
| `core/src/instructions/builtins.ts` | maps | `core/geo` instruction: maps tools, analysis choice, Laya + ranking workflow |
| `httpapi-codegen/src/index.ts`, `client/src/promise/generated/client.ts` | launcher | `encodePath` sends the path as `~b64~<base64url>` so `/api/fs/read/...` never names the file (IDM decodes `%2E` and still grabbed `report%2Epdf`) |
| `server/src/handlers/fs.ts` | launcher | `fs.read` decodes `~b64~` paths (percent-encoded still works) and answers fetches (`Sec-Fetch-Dest: empty`) as `application/octet-stream`; test in `server/test/fs.test.ts` |
| `cli/src/services/web-ui.ts` | v1 | CSP: `media-src … blob:` (voice, video previews), `frame-src 'self' blob: https: http://localhost:* http://127.0.0.1:*` (proxied pages, map embeds, loopback canvas and dev servers; `http://[::1]:*` is not a valid source); the theme-preload hash is taken after CRLF→LF normalization, as browsers do (Windows builds were blocking the script); test in `cli/test/web-ui.test.ts` |
| `client/src/*/generated/*` | v1 | regenerate with `bun run generate` in `packages/client`; never merge these by hand |
| `client/src/effect/api/api.ts` | v1 | browser-proxy group in the Effect client |
| `core/src/instructions/builtins.ts` | v1 | built-in instruction `core/output-files`: link produced files with absolute forward-slash paths (test `core/test/instructions/builtins.test.ts`); fork.3 adds `core/response-contract` + `core/memory` instruction sources |
| `core/src/tool/plugin/research.ts` | maps | place/hotel/event without `OPENCODE_<CAT>_API_URL` search Maps first (`placeCandidate`), web search only when Maps finds nothing; fork.3 renames status to `classifier` (+ deprecated `laya` alias) |
| `core/src/tool/plugin/laya.ts` | fork.3 | deprecated shim re-exporting `core/src/classifier/engine.ts`; registers `classifier_classify` + alias `laya_classify` for one release |
| `core/src/plugin/internal.ts` | chat | "preserve v2 runtime and model completion behavior" (9Router/OpenAI-compatible completion fixes), tool registration in `core/src/plugin/internal.ts` (+ fork.3: `MemoryTool`, `ScrapeTool`, `ClassifierPlugin`), Laya flag in `schema/src/config/experimental.ts` |

### Session UI (`packages/session-ui`)

| File | Layer | Hook |
| --- | --- | --- |
| `timeline/projection.ts` | v1 | Chat/Classifier keep result cards (`timelineResultTool`) and show a generic Thinking row while tools are hidden |
| `timeline/result-tools.ts` | fork.3 | `scrape_fetch`/`scrape_status`/`memory_search` join `CARD_TOOLS` so they stay visible in Chat/Classifier views |
| `timeline/session-timeline-row.tsx` | chat + v1 | generated-file cards computed once per turn (`createTurnArtifacts`) on the copy-row part, or after the last row of a turn without text; hidden-thinking shimmer; user annotations passed to the bubble |
| `message/message-content.tsx`, `message/current-message.tsx`, `actions.ts` | chat + v1 | one `artifacts` prop for the file cards (plus `artifactsExist` action); `UserMessageAnnotations` cards above the sent bubble |
| `tools/tool-renderer.tsx` | chat + v1 | maps/jobs/research/action/citation cards (chat), i18n for those cards (v1); fork.3 adds `ScrapeToolOutput`/`MemoryToolOutput` (scrape/memory cards reusing `BasicTool`+`ResultCard`) |
| `components/{message-part,basic-tool}.css` | chat | result and citation card styles (the file-card styles moved to `fork/fork.css`) |
| `styles/index.css` | v1 | `@import "../fork/fork.css" layer(components)` |

### UI (`packages/ui`)

| File | Layer | Hook |
| --- | --- | --- |
| `context/marked-parser.tsx` | v1 | `.use(katexExtension, calloutExtension, …)` |
| `context/marked-base.tsx` | v1 | the main-thread small-block parser also uses `calloutExtension`; without it, short callouts render as plain quotes |
| `i18n/en.ts` | v1 | `ui.selectionBar.*`, `ui.tool.*`, `ui.resultCard.*`, `ui.message.annotation.*`, `ui.artifact.*` (file-card kinds, subtitle, Download) (English only; other locales fall back); fork.3 adds `ui.tool.scrape.*`, `ui.tool.memory.*` |
| `icons/icon/additional-icons.ts` | chat | `mic` |

### App (`packages/app`)

| File | Layer | Hook |
| --- | --- | --- |
| `index.css` | v1 | `@import "./fork/fork.css"` |
| `entry.tsx` | launcher | `authFromToken(launcherToken(location.search))` instead of reading `?auth_token=` only once |
| `session/timeline/virtualizer.tsx` | launcher | fixes an upstream freeze. When `devicePixelRatio` is below 1 (for example 125% Windows scaling with 75% browser zoom = 0.9375), the reachable scroll end is one device pixel (1.07px) short. The cold-bottom settle only accepted a 1px gap, so it re-pinned forever in microtasks, and the tab showed an empty timeline and took no input. Now: <br>• the reach tolerance is `1 + 1/devicePixelRatio`<br>• more than 200 settle passes without yielding reveal the timeline<br>• a cold mount still pending after 3s is revealed<br>• `atEnd` allows one device pixel when zoomed out, so following can resume |
| `shell/notifications/sound.ts` | launcher | sounds imported with `query: "?inline"` (data URIs). As separate `.aac` files the service worker precached them at every start, and download managers (IDM) grabbed those requests with a "download this file" popup |
| `runtime/i18n/en.ts` | chat + v1 | all fork strings (English only) |
| `runtime/server/sync.tsx` | v1 | `assignProjectColors(...)`: v1 random avatar colour for projects without an icon |
| `composer/{comment-note,request,submit}.ts`, `session/composer/queue.ts`, `session/route.tsx` | chat + v1 | quotes/page text/media annotations carried in message metadata (`promptAnnotations`); comment-less context is cleared after send |
| `composer/{composer,editor/editor}.tsx`, `composer/{editor/interaction,model,schema,types,prompt-parts}.ts` | chat + v1 | Classifier banner removed, voice button (hidden when unsupported; after Send in tab order, shown left of it by `fork.css`), prompt library, context cards (`group` class), `appendDraftText` |
| `composer/view-mode-control.tsx`, `session/view-mode.ts`, `session/timeline/controller.tsx` | chat + v1 | Chat/Code/Classifier dropdown; per-session mode stored server-global with draft handoff; Chat/Classifier edit tools grouped; `timelineDetail` compares by content, because the virtualizer resets expanded tools on every detail notification (the chat-layer regression behind `session-timeline-cache` and `subagent-child-navigation`) |
| `home/sessions/view.tsx`, `new-session/composer-adapter.ts` | v1 | Topics row, topic filter, "Move to topic", side chats nested under their parent; new sessions join the selected topic |
| `session/files/session-side-panel.tsx`, `session/helpers.ts` | chat + v1 | "+" menu in v1 order (Open file, Browser, Terminal, Side chat, Canvas, Research), with the Browser shortcut shown only for the native pane; Research/Canvas/web/side-chat tabs are sortable and closable |
| `session/files/{artifact-view,file-tabs,open-artifact}.tsx`, `workspaces/files/artifact.ts` | chat + v1 | office/PPTX previews (chat); PDFs render through `fork/pdf/pdf-pages.tsx` (HTML keeps the sandboxed blob frame); region and text annotation overlays, async pdf.js text, file-card download through `fork/artifact-download.ts`, `exists` for the cards, `file:` hrefs (v1) |
| `session/composer/region.tsx` | chat + v1 | wires `openArtifact`/`downloadArtifact`/`artifactsExist` into the timeline actions |
| `session/browser/pane.tsx` (+ `attachments.ts`, `connection.ts`, `model.ts`) | chat + v1 | desktop native pane region capture (chat); unified selection bar instead of `window.prompt` polling (v1) |
| `session/screen.tsx` | chat + v1 | `ResearchAskChatListener` inserts into the draft instead of replacing it; mounts `CanvasOpenListener` (fork/web-browser) |
| `session/timeline/message-timeline.tsx` | chat + v1 | annotated messages wait for their presentation before rendering |
| `settings/general/general.tsx`, `settings/model.tsx` | chat + v1 | default conversation view (stored `laya` normalizes to `classifier`); research-provider block rendered full width after the list |
| `settings/{surface.tsx,pages.ts,shell.tsx,search-catalog.ts}` | fork.3 | Settings → Scraper + Memory tabs (`settings/scrape/{scrape.tsx,model.ts}`, `settings/memory/{memory.tsx,model.ts}`): persisted mode/auto-setup/vault prefs, `archive`/`comment` icons, searchable; same `SettingsList/Row` structure as Maps |
| `runtime/i18n/en.ts` | fork.3 | `settings.scraper.*`, `settings.memory.*`, classifier view-mode labels; guide banner removed |
| `desktop.ts`, `runtime/platform/browser-pane.ts`, `custom-elements.d.ts` | chat | region-capture IPC contract |

`packages/desktop/**` and `packages/plugin-browser/src/rpc.ts` carry chat-layer hooks for the Electron
browser pane (region capture, text selection, `plugins: true` for the PDF viewer).

### Upstream E2E tests adapted to fork behaviour (`packages/app/e2e`)

| Test | Why it differs from upstream |
| --- | --- |
| `utils/side-panel.ts` (new) + `regression/{file-browser-sidebar-tab-switch,open-file-expand-folder,review-open-file,review-state-persistence}.spec.ts` | the side-panel "+" is always a menu, so "Open file" is a menu item, not a one-click button |
| `regression/session-summary-layout.spec.ts` | conversation rows are 800px (v1 column), not 1000px |
| `regression/prompt-thinking-level.spec.ts` | the Chat/Code/Classifier control is a tab stop between Add and Model |
| `regression/remote-session-settings.spec.ts` | settings open as the v1 dialog (≤1000px), so the sidebar takes the compact 240px width |
| `regression/workspace-accent.spec.ts` | local sessions use the grey v1 bubble; workspace sessions keep upstream's accent |
| `regression/mobile-timeline-scroll.spec.ts` | its pixel probe tracks blue prompt ink; `markPromptInk` paints the grey bubble blue for the probe |
| `utils/mock-server.ts` | `projectUpdate` falls back to the project worktree like `projectList` (the fork saves v1 avatar colours on load); `fsRead` passes `Uint8Array` content through for byte-exact download tests |
| `user-story/{research-shortlist,view-mode-toggle}.spec.ts` (chat layer) | result cards are never folded into a "Used N" group; the mode control is a Chat/Code/Classifier dropdown |
| `user-story/{scrape-ultimate,settings-scraper-memory}.spec.ts` (fork.3) | scrape result card renders with engine attribution; Scraper/Memory settings tabs persist controls (mock-only) |
| `performance/timeline/session-timeline-stream-probe.ts` (chat layer) | the chat layer's `Reflect.apply` tripped lint; calls the typed `scrollTo` overloads instead |

Deliberately left as upstream, because upstream tests encode them as design decisions: the "Used N Read,
Grep" tool-group label (v1 said "Explored 1 read") and the variant picker that only shows "Default" on
hover.

## Rebase onto a new upstream tag

```bash
git fetch origin --tags
git switch -c rebase-v2.x.y v1-ux-restore
git rebase --onto v2.x.y v2.0.15
```

- Resolve conflicts only in the files above. Keep upstream's new code and re-apply the hook's intent
  from the tables; `git grep -n "fork:"` finds the larger v1 hooks.
- Never hand-merge `packages/client/src/*/generated/*`. After the rebase, run `bun install`, then
  `bun run generate` in `packages/client`.
- Verify from each package directory: `bun run typecheck` (app, ui, session-ui, protocol, client, server,
  cli), `bun test src` (ui, session-ui), `bun run test:unit` and `bun run test:browser` (app),
  `bun test test/browser-proxy.test.ts` (server), and `bun run lint` at the root.
- E2E runs against the mock API only. Point it at an unused port so nothing can reach the live
  server on 4096:
  `PLAYWRIGHT_PORT=3107 PLAYWRIGHT_SERVER_PORT=4998 node node_modules/@playwright/test/cli.js test` in
  `packages/app`. The 8 `mobile-timeline-scroll` "detached session gestures" tests also fail on pristine
  v2.0.15 in local dev mode.
- Visual check against v1: the QA harness in `C:\Users\fadhi\opencode-qa-uxdiff` (`start.ps1 -V2Source`,
  `bun pw.ts v2h <steps>.json`) with the v1 baseline shots in `shots/v1-*.png`.

## Known limits

- PDF and HTML previews capture regions with `getDisplayMedia`, which asks for screen-share
  permission once per session. Images and video are cropped directly.
- The v1 LibreOffice fallback is not ported, because `soffice` isn't installed. `pptx-preview` renders
  PPTX client-side.
- The browser proxy blocks private and loopback targets on every redirect hop. DNS rebinding between
  the check and the fetch is not prevented. Proxied pages always run in an opaque-origin sandbox.
