export * as UserHooksPlugin from "./user-hooks.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// fork: user hooks and a shell safety guard.
//
// `<config>/hooks.json` (next to opencode.json) lets the owner react to tool calls without writing a plugin:
//
//   { "guard": true,
//     "before": [{ "tool": "shell", "contains": "git push --force", "action": "deny", "message": "No force pushes." }],
//     "after":  [{ "tool": "write|edit|patch", "run": "prettier --write \"{path}\"" }] }
//
// `tool` is a name, `a|b`, or `*`. A before rule matches when the tool input (the command for shell, otherwise its JSON)
// contains `contains` or matches `regex`; "deny" rejects the call with `message`. An after rule runs a shell command
// (30 s limit, failures ignored) with `{path}` and `{tool}` replaced. `guard` (default on) blocks a short list of
// catastrophic shell commands: wiping a drive or home folder, formatting, disk writes, shutdown, piping a download into
// a shell. It is a seatbelt, not a sandbox: the permission prompts remain the real control.

export type BeforeRule = { tool: string; contains?: string; regex?: string; action?: "deny"; message?: string }
export type AfterRule = { tool: string; run: string }
export type Rules = { guard: boolean; before: BeforeRule[]; after: AfterRule[] }

const GUARD: ReadonlyArray<readonly [RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)[a-z]*\s+(\/|~|\$HOME|\*)(\s|$|\/\*)/i, "recursive delete of the root, home or everything"],
  [/\bRemove-Item\b[^\n]*-Recurse[^\n]*\s['"]?[a-z]:\\?\*?['"]?(\s|$)/i, "recursive delete of a whole drive"],
  [/\b(del|erase)\b[^\n]*\/s[^\n]*\s['"]?[a-z]:[\\/]\*?['"]?(\s|$)/i, "recursive delete of a whole drive"],
  [/\b(rd|rmdir)\b[^\n]*\/s[^\n]*\s['"]?[a-z]:\\?['"]?(\s|$)/i, "recursive delete of a whole drive"],
  [/\bformat(\.com)?\s+[a-z]:/i, "formatting a drive"],
  [/\bmkfs(\.\w+)?\b/i, "creating a filesystem"],
  [/\bdd\b[^\n]*\bof=\/dev\//i, "writing directly to a disk device"],
  [/:\(\)\s*\{\s*:\s*\|\s*:/, "fork bomb"],
  [/(^|[;&|(]\s*)(shutdown|Stop-Computer|Restart-Computer)\b/i, "shutting the computer down"],
  [/\breg(\.exe)?\s+delete\s+HKLM/i, "deleting machine registry keys"],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i, "piping a download straight into a shell"],
]

/** Reason a shell command is blocked by the guard, or undefined when it is allowed. */
export function guardReason(command: string) {
  return GUARD.find(([pattern]) => pattern.test(command))?.[1]
}

export function parseRules(text: string | undefined): Rules {
  const empty: Rules = { guard: true, before: [], after: [] }
  if (!text) return empty
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== "object") return empty
    const record = value as Record<string, unknown>
    const list = (input: unknown) => (Array.isArray(input) ? input.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [])
    return {
      guard: record.guard !== false,
      before: list(record.before).flatMap((item): BeforeRule[] =>
        typeof item.tool === "string"
          ? [
              {
                tool: item.tool,
                contains: typeof item.contains === "string" ? item.contains : undefined,
                regex: typeof item.regex === "string" ? item.regex : undefined,
                action: "deny",
                message: typeof item.message === "string" ? item.message : undefined,
              },
            ]
          : [],
      ),
      after: list(record.after).flatMap((item): AfterRule[] =>
        typeof item.tool === "string" && typeof item.run === "string" ? [{ tool: item.tool, run: item.run }] : [],
      ),
    }
  } catch {
    return empty
  }
}

const toolMatches = (pattern: string, tool: string) => pattern === "*" || pattern.split("|").some((name) => name.trim() === tool)

/** The text a rule is matched against: the command for shell, otherwise the JSON of the input. */
export function inputText(tool: string, input: unknown) {
  if (input && typeof input === "object" && "command" in input && typeof input.command === "string") return input.command
  void tool
  const file = inputPath(input)
  return file ? `${file}
${JSON.stringify(input)}` : JSON.stringify(input ?? {})
}

export function inputPath(input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  const value = record.filePath ?? record.path ?? record.file
  return typeof value === "string" ? value : undefined
}

export function blockReason(rules: Rules, tool: string, input: unknown) {
  const text = inputText(tool, input)
  if (rules.guard && tool === "shell") {
    const reason = guardReason(text)
    if (reason)
      return `Blocked by the safety guard (${reason}). Do not retry this command; tell the user what you wanted to do and let them run it themselves, or set "guard": false in hooks.json.`
  }
  const rule = rules.before.find((item) => {
    if (!toolMatches(item.tool, tool)) return false
    if (item.contains !== undefined && !text.includes(item.contains)) return false
    if (item.regex !== undefined) {
      try {
        if (!new RegExp(item.regex, "im").test(text)) return false
      } catch {
        return false
      }
    }
    return item.contains !== undefined || item.regex !== undefined
  })
  return rule ? (rule.message ?? `Blocked by a hooks.json rule for ${tool}.`) : undefined
}

export function afterCommands(rules: Rules, tool: string, input: unknown) {
  const file = inputPath(input) ?? ""
  return rules.after
    .filter((item) => toolMatches(item.tool, tool))
    .map((item) => item.run.replaceAll("{path}", file).replaceAll("{tool}", tool))
}

const run = (command: string) =>
  new Promise<void>((resolve) => {
    const child = spawn(command, { shell: true, windowsHide: true, stdio: "ignore" })
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 30_000)
    child.on("error", () => {
      clearTimeout(timer)
      resolve()
    })
    child.on("close", () => {
      clearTimeout(timer)
      resolve()
    })
  })

export const Plugin = define({
  id: "opencode.user-hooks",
  effect: Effect.fn("UserHooksPlugin")(function* (ctx) {
    const global = yield* Global.Service
    const file = path.join(global.config, "hooks.json")
    // Read per call and cache by modification time, so edits apply without a restart.
    const cache = { mtime: -1, rules: parseRules(undefined) }
    const rules = () => {
      try {
        const mtime = fs.statSync(file).mtimeMs
        if (mtime !== cache.mtime) {
          cache.mtime = mtime
          cache.rules = parseRules(fs.readFileSync(file, "utf8"))
        }
      } catch {
        cache.mtime = -1
        cache.rules = parseRules(undefined)
      }
      return cache.rules
    }
    yield* ctx.tool.hook("execute.before", (event) => {
      const reason = blockReason(rules(), event.tool, event.input)
      return reason ? Effect.fail(new ToolFailure({ message: reason })) : Effect.void
    })
    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") return Effect.void
      const commands = afterCommands(rules(), event.tool, event.input)
      return commands.length === 0 ? Effect.void : Effect.promise(() => Promise.all(commands.map(run))).pipe(Effect.asVoid)
    })
  }),
})
