import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages, DesktopCli } from "./desktop-cli"
import { SidecarCredentials } from "./sidecar-credentials"
import { sidecarProbe } from "./sidecar-probe"

export * as BackgroundService from "./background-service"

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()
    return Service.of(
      yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: connect("reconnect").pipe(Effect.provide(context), Effect.orDie),
      }),
    )
  }),
)

const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  // fork: the owner's launcher already runs the server on a fixed port with the password from
  // ~/.config/opencode/service.json. Starting a second server on the same database would let two
  // processes resume the same sessions, so the desktop adopts that server instead of spawning one.
  const explicit = explicitServer()
  if (explicit) {
    yield* Effect.logInfo("using the launcher's server", endpoint(explicit.url))
    SidecarCredentials.set(explicit)
    return explicit
  }
  yield* Effect.logInfo("starting v2 background service")
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const cli = yield* desktopCli.resolve
  const version = mode === "initial" ? cli.version : undefined
  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))
  const ensure = () =>
    client.Service.ensure({
      file:
        isolated && process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
          ? path.join(app.getPath("userData"), "opencode", "service-local.json")
          : undefined,
      version,
      command: [...cli.command, "serve", "--service", ...(isolated ? ["--hostname", "0.0.0.0", "--port", "0"] : [])],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    })
  // A compatible service the entry module already found is adopted at once; ensure() still runs
  // afterwards for its side effects (terminal handoff completion), off the renderer's path.
  const early = mode === "initial" && !isolated ? yield* Effect.promise(sidecarProbe) : undefined
  if (early) yield* Effect.sync(() => void ensure().catch(() => undefined))
  const service = early ?? (yield* Effect.tryPromise(ensure))
  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("v2 CLI background service ready", {
    version,
    probed: !!early,
    ...endpoint(url.origin),
  })
  if (mode === "initial" && isolated && cli.binary) yield* cleanStages(cli.binary).pipe(Effect.orDie)
  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)
  return ready
})

function explicitServer(): SidecarCredentials.Data | undefined {
  const raw = process.env.OPENCODE_DESKTOP_SERVER_URL
  if (!raw || !URL.canParse(raw)) return
  const file = process.env.OPENCODE_DESKTOP_SERVER_PASSWORD_FILE ?? join(homedir(), ".config", "opencode", "service.json")
  const password = (() => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { password?: unknown }
      return typeof parsed.password === "string" ? parsed.password : null
    } catch {
      return null
    }
  })()
  return { url: new URL(raw).origin, password }
}

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}
