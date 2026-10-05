# UI migration to upstream v2.0.22 (not started; measured 2026-10-05)

State: backend packages (ai, core, schema, plugin, util, codemode, protocol, server, tui, cli, sdk, client) are upstream v2.0.22
since `2.0.22-fork.1`. The UI (`app`, `ui`, `session-ui`, `desktop`) is still the fork's v2.0.15 UI, which works against the new backend.

## Why it is a project, not a merge
Upstream commit `f406d93a66` ("move GUI features into built-in extensions", #52369) moved the browser, file/artifact, review, summary and
side-chat features into `packages/gui-extensions` and a host in `packages/app/src/runtime/extension/*`. A trial
`git apply --3way` of the upstream UI diff over the fork reports:

- 18 files deleted upstream but modified by the fork: `session/browser/*`, `runtime/platform/browser-pane.ts`,
  `session/files/{open-artifact,session-side-panel}.tsx`, `desktop/src/shared/ipc-rpc/browser.ts`, 9 e2e specs.
- ~30 content conflicts: composer (`schema`, `request`, `submit`, `model`, `comment-note`, `composer.tsx`, `editor.tsx`), `session/{screen,helpers}`, `timeline/message-timeline.tsx`,
  settings (`model`, `shell`, `surface`, `search-catalog`), `shell/shell.tsx`, `workspaces/files/artifact.ts`, `home/sessions/view.tsx`, `session-ui` markdown/timeline row.
- Git aborts the whole apply on the modify/delete files, so the work has to be done by hand file by file.

## Plan (each step ends with check + unit tests + mock E2E + owner's visual QA)
1. Worktree `../opencode-sync-ui` on `sync/ui` from `v1-ux-restore`. `git diff v2.0.15 v2.0.22 -- packages/app packages/ui packages/session-ui packages/desktop packages/gui-extensions` is the starting patch.
2. Take upstream for every deleted/relocated file, then make `bun run check` and the upstream tests green with the fork UI hooks removed.
3. Re-add fork features onto the extension points, one at a time: file preview (Exact Office, PDF, HTML annotation) into `gui-extensions/src/file`;
   composer annotations on `NoteContextItem`; side-panel tabs (Canvas, Research, Map, web, side chat; compare with upstream `btw`); settings tabs; v1 view modes and timeline cards; Browser pane proxy.
4. Release `2.0.22-fork.N` only after the owner has used it side by side with the current build.

Estimate: 3-5 days of focused work. Benefit: upstream UI features (review panel, element comments, extension settings) and no further drift.
Trigger to start: an upstream UI feature the owner wants, or a UI bug upstream already fixed.
