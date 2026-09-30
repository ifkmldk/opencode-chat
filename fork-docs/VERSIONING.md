# Fork versioning

Versions look like `<upstream version>-fork.<n>`, for example `2.0.15-fork.1`.

- The first part is the upstream opencode release the fork is built on (`packages/cli/package.json`, tag
  `v2.0.15` upstream).
- `fork.<n>` counts fork releases on that base. It restarts at 1 when the fork moves to a new upstream release,
  for example `2.0.20-fork.1`.

The current version is in `FORK_VERSION` at the repo root. Each release gets:

1. An entry in [`CHANGELOG-FORK.md`](CHANGELOG-FORK.md).
2. An annotated git tag `fork-v<version>`, for example `fork-v2.0.15-fork.1`, pushed to the `fork` remote.
3. A deploy to the launcher with the channel build (`OPENCODE_CHANNEL=custom/main`). See `handoff.md` §5.

## Branches

| Branch | What it is |
| --- | --- |
| `v1-ux-restore` | The fork's working branch today, based on upstream v2.0.15. |
| `v2` / `origin/v2` | Upstream (anomalyco/opencode). Read-only for us. |
| `sync/<upstream-tag>` | Temporary branch for bringing in a new upstream release (see `UPSTREAM-SYNC.md`). |

Pushes go only to the `fork` remote (`git@github-pribadi:ifkmldk/<repo>.git`). Never push to `origin`.

## Never commit

- `~/.config/opencode/opencode.json`, which holds a live 9Router apiKey.
- `service.json`, and any file with a password, API key or token.
- Session databases (`*.db`) and QA folders.
