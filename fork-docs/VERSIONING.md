# Fork versioning

Versions look like `<upstream version>-fork.<n>`, for example `2.0.15-fork.1`.

- The first part is the upstream opencode release the fork is built on (`packages/cli/package.json`, tag
  `v2.0.15` upstream).
- `fork.<n>` counts fork releases on that base. It restarts at 1 when the fork moves to a new upstream release,
  for example `2.0.20-fork.1`.

The current version is in `FORK_VERSION` at the repo root. Each release gets:

1. An entry in [`CHANGELOG-FORK.md`](CHANGELOG-FORK.md).
2. A public snapshot commit on the `fork` remote's `main`, with the annotated tag `fork-v<version>` on it
   (see "Publishing" below).
3. A deploy to the launcher with the channel build (`OPENCODE_CHANNEL=custom/main`). See `handoff.md` §5.

## Branches

| Branch | What it is |
| --- | --- |
| `v1-ux-restore` | The fork's working branch today, based on upstream v2.0.15. |
| `v2` / `origin/v2` | Upstream (anomalyco/opencode). Read-only for us. |
| `sync/<upstream-tag>` | Temporary branch for bringing in a new upstream release (see `UPSTREAM-SYNC.md`). |

Pushes go only to the `fork` remote (`git@github-pribadi:ifkmldk/opencode-chat.git`). Never push to `origin`.

## Publishing (only ifkmldk as contributor)

GitHub builds its contributor list from commit authors. The working branch carries upstream opencode's full
history, with thousands of authors, so it is **never pushed as is**.

The public `main` on GitHub instead gets **one snapshot commit per release**. The commit has:
- the working branch's tree
- the previous public commit as its parent
- author and committer `Irsyad Akmaldika <117720531+ifkmldk@users.noreply.github.com>`
- no co-author trailers

```bash
TREE=$(git rev-parse v1-ux-restore^{tree})
git fetch fork main
ID="Irsyad Akmaldika"; MAIL="117720531+ifkmldk@users.noreply.github.com"
COMMIT=$(GIT_AUTHOR_NAME="$ID" GIT_AUTHOR_EMAIL="$MAIL" GIT_COMMITTER_NAME="$ID" GIT_COMMITTER_EMAIL="$MAIL"   git commit-tree "$TREE" -p FETCH_HEAD -m "release: $(cat FORK_VERSION)")
git push fork "$COMMIT:refs/heads/main"
git tag -a "fork-v$(cat FORK_VERSION)" "$COMMIT" -m "Fork release $(cat FORK_VERSION)" && git push fork "fork-v$(cat FORK_VERSION)"
```

The local branch keeps the full upstream history, which the upstream sync in `UPSTREAM-SYNC.md` needs. The
`fork-v*` tags point at the public snapshot commits.

## Never commit

- `~/.config/opencode/opencode.json`, which holds a live 9Router apiKey.
- `service.json`, and any file with a password, API key or token.
- Session databases (`*.db`) and QA folders.
