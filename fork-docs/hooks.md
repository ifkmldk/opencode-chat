# User hooks and the shell guard

File: `hooks.json` in the opencode config folder (the folder with `opencode.json`, normally `~/.config/opencode`). It is read on every tool call, so edits apply without a restart.

```json
{
  "guard": true,
  "before": [
    { "tool": "shell", "contains": "git push --force", "message": "No force pushes." },
    { "tool": "write|edit|patch", "regex": "\.env$", "message": "Do not touch .env files." }
  ],
  "after": [
    { "tool": "write|edit", "run": "prettier --write \"{path}\"" }
  ]
}
```

- `tool`: a tool name, `a|b`, or `*`.
- `before` rules deny the call when the input matches `contains` (plain text) or `regex` (case-insensitive, multiline). For shell the input is the command; for file tools it is the path plus the JSON. A rule with neither condition never matches. The model sees `message` and is told not to retry.
- `after` rules run a shell command when the tool completed (30 s limit, failures ignored). `{path}` and `{tool}` are replaced.
- `guard` (default `true`) blocks catastrophic shell commands: recursive delete of `/`, `~`, `$HOME`, `*` or a whole drive, `format`, `mkfs`, `dd` to a device, fork bombs, `shutdown`/`Stop-Computer`, `reg delete HKLM`, and `curl|wget|iwr ... | sh|bash|iex`.

The guard is a seatbelt, not a sandbox: it matches command text, so it cannot see through variables or scripts. Permission prompts remain the real control. Tests: `packages/core/test/user-hooks.test.ts`.
