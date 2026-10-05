# Staying in step with upstream opencode

Goal: fork features stay primary, and the fork still takes every good upstream improvement.

## 1. Keep the fork easy to merge

- New fork features live in fork-owned files (`packages/*/src/fork/…`, `core/src/maps/…`). Those never conflict.
- Upstream files get **small, marked hooks only**, each commented `// fork:` and listed in
  [`../FORK-HOOKS.md`](../FORK-HOOKS.md). When a merge conflicts, that table says what the hook does and why.
- Prefer extending an upstream feature over copying it. A copy drifts; a hook moves with upstream.
- Generated files (`packages/client/src/*/generated`) are never hand-fixed. Change the generator
  (`httpapi-codegen`) or the protocol, then run `bun run generate` in `packages/client`.

## 2. When upstream ships a release (check about every 1–2 weeks)

```
git fetch origin --tags
git log --oneline v2.0.15..origin/v2 -- packages/app packages/session-ui packages/core packages/server
```

For each notable change, decide one of these and record it in the table below:

| Decision | When |
| --- | --- |
| **Adopt** | Upstream adds something we lack, or fixes a bug we also have. Take it as is. |
| **Adopt + adapt** | Good, but it touches a fork hook or UI. Take it, then re-apply the hook. |
| **Replace ours** | Upstream now does what a fork feature did, and does it as well or better. Drop our copy to cut maintenance. |
| **Keep ours** | Our version is better for the owner (for example v1 UX, Maps, the IDM fixes). Keep the hook and skip or override upstream's version. |

## 3. How to bring a release in (never on the live 4096 launcher)

1. Create a branch: `git switch -c sync/v2.0.20 v1-ux-restore`.
2. Merge the upstream tag with `git merge v2.0.20`. Use merge, not rebase: the fork branch is pushed and
   history stays readable.
3. Resolve conflicts using FORK-HOOKS.md. If a hook's upstream code moved, re-apply the hook at the new place.
4. Regenerate the client (`bun run generate`) and run the checks:
   - `bun typecheck` in core, `bun run test:unit` in app, `bun test` in session-ui, client, server and core.
   - The E2E suite against the mock LLM (never the 9Router quota).
   - `bun run bench:tabs` in app, compared against the last numbers in `handoff.md`.
5. Build with `OPENCODE_CHANNEL=custom/main` and try it on an isolated port with a DB copy. Then deploy and
   keep the previous exe for rollback.
6. Merge `sync/…` into the working branch, bump `FORK_VERSION` to `<new upstream>-fork.1`, add a
   CHANGELOG-FORK entry, tag and push.

## 4. Feature-gap review

Before each sync, list what upstream added in the web UI that the fork doesn't show, and what the fork has that
upstream doesn't. Keep the lists short and decide per item (Adopt / Replace ours / Keep ours). The fork's
distinctive features to protect are:

- v1 UX and view modes
- file cards and previews
- the side-panel canvas
- Maps, spatial analysis and the Laya integration
- launcher, IDM and service-worker fixes

## Sync log

| Date | Upstream | Adopted | Kept ours | Notes |
| --- | --- | --- | --- | --- |
| 2026-09-30 | v2.0.15 (base) | — | — | First versioned fork release `2.0.15-fork.1`. |
| 2026-10-05 | v2.0.22 (trial, aborted) | — | — | 321 commits, 2531 files. `git merge v2.0.22` conflicts in about 100 files: upstream deleted the files the fork modified for the browser pane and side panel (`session/browser/*`, `runtime/platform/browser-pane.ts`, `session/files/{open-artifact,session-side-panel}.tsx`) and reshaped composer, settings shell, `session/screen.tsx`, `workspaces/files/artifact.ts`, `core/src/instructions/builtins.ts`, plus every `package.json`. Not merged: needs a planned, owner-approved migration of the fork hooks, not a one-sitting merge. |
