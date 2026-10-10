import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Tests the standalone vault MCP server (stdio JSON-RPC) against a throwaway vault, never the owner's real one.
const SERVER = path.join(os.homedir(), ".config", "opencode", "vault-mcp.mjs")
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vmcp-"))
const vault = path.join(root, "vault")
const outside = path.join(root, "outside")
let proc: ReturnType<typeof Bun.spawn>
let buffer = ""
const pending = new Map<number, (m: any) => void>()
let nextId = 1

const call = (method: string, params: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = nextId++
    pending.set(id, resolve)
    ;(proc.stdin as any).write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    setTimeout(() => reject(new Error("timeout " + method)), 15000)
  })
const tool = async (name: string, args: Record<string, unknown>) => {
  const reply = await call("tools/call", { name, arguments: args })
  return { text: String(reply.result?.content?.[0]?.text ?? reply.error?.message ?? ""), isError: reply.result?.isError === true || !!reply.error }
}

beforeAll(async () => {
  fs.mkdirSync(path.join(vault, "entries"), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(vault, "global.md"), "# hello vault\nline two\n")
  fs.writeFileSync(path.join(outside, "secret.txt"), "TOP-SECRET-OUTSIDE")
  proc = Bun.spawn(["node", SERVER], { env: { ...process.env, VAULT_DIR: vault }, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const decoder = new TextDecoder()
  ;(async () => {
    for await (const chunk of proc.stdout as any) {
      buffer += decoder.decode(chunk)
      let i
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        try {
          const m = JSON.parse(line)
          pending.get(m.id)?.(m)
          pending.delete(m.id)
        } catch {}
      }
    }
  })()
  await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } })
  ;(proc.stdin as any).write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
})

afterAll(() => {
  proc?.kill()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("vault MCP server", () => {
  test("exposes exactly the four vault tools", async () => {
    const reply = await call("tools/list", {})
    expect(reply.result.tools.map((t: any) => t.name).sort()).toEqual(["vault_list", "vault_read", "vault_search", "vault_write"])
  })

  test("reads a file inside the vault", async () => {
    const r = await tool("vault_read", { path: "global.md" })
    expect(r.isError).toBe(false)
    expect(r.text.split("\n")[0]).toBe("# hello vault")
  })

  test("rejects relative traversal out of the vault", async () => {
    const r = await tool("vault_read", { path: "../outside/secret.txt" })
    expect(r.isError).toBe(true)
    expect(r.text).not.toContain("TOP-SECRET")
  })

  test("rejects absolute paths outside the vault", async () => {
    const r = await tool("vault_read", { path: path.join(outside, "secret.txt") })
    expect(r.isError).toBe(true)
    expect(r.text).not.toContain("TOP-SECRET")
  })

  test("rejects writes outside the vault", async () => {
    const target = path.join(root, "escape.md")
    const r = await tool("vault_write", { path: "../escape.md", content: "x" })
    expect(r.isError).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  })

  test("writes and reads back inside the vault", async () => {
    const w = await tool("vault_write", { path: "entries/note.md", content: "# note\nDIGEST-TEST-TOKEN\n" })
    expect(w.isError).toBe(false)
    expect(fs.readFileSync(path.join(vault, "entries/note.md"), "utf8")).toContain("DIGEST-TEST-TOKEN")
    const s = await tool("vault_search", { query: "digest-test-token" })
    expect(s.text).toContain("entries/note.md")
  })

  test("search and list stay inside the vault", async () => {
    const l = await tool("vault_list", { path: "" })
    expect(l.text).toContain("global.md")
    expect(l.text).not.toContain("secret")
    const s = await tool("vault_search", { query: "TOP-SECRET" })
    expect(s.text).toContain("no matches")
  })

  test("symlink inside the vault must not reach files outside it", async () => {
    const link = path.join(vault, "link-out")
    try {
      fs.symlinkSync(outside, link, "junction")
    } catch {
      return // symlink creation not permitted on this host; covered by the realpath check in review
    }
    const r = await tool("vault_read", { path: "link-out/secret.txt" })
    expect(r.text).not.toContain("TOP-SECRET-OUTSIDE")
    fs.rmSync(link, { force: true })
  })

  test("unknown tool and unknown method return errors, server keeps running", async () => {
    const bad = await tool("vault_delete_everything", {})
    expect(bad.isError).toBe(true)
    const unknown = await call("nonsense/method", {})
    expect(unknown.error?.code).toBe(-32601)
    const still = await tool("vault_read", { path: "global.md" })
    expect(still.isError).toBe(false)
  })

  test("a malformed line does not kill the server", async () => {
    ;(proc.stdin as any).write("{not json\n")
    const still = await tool("vault_read", { path: "global.md" })
    expect(still.isError).toBe(false)
  })
})
