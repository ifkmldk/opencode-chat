import { describe, expect, test } from "bun:test"
import { planFor, stubOutput, __test as engineTest } from "../src/scrape/engine.js"
import {
  autoSetupEnabled,
  camofoxBackend,
  camofoxServerUrl,
  describeAvailability,
  resolveScrapegraphLLM,
} from "../src/scrape/setup.js"
import { argsFor as agentReachArgs, parseResult as parseAgentReach } from "../src/scrape/bridges/agent-reach.js"
import {
  authHeaders,
  backend as camofoxBridgeBackend,
  fetchPayload,
  healthUrl as camofoxHealthUrl,
  parseResult as parseCamofox,
  PYTHON_BRIDGE as CAMOFOX_PY_BRIDGE,
  PYTHON_SPEC as CAMOFOX_PY_SPEC,
  pythonPayload as camofoxPythonPayload,
  serverUrl,
} from "../src/scrape/bridges/camofox.js"

describe("ultimate scraper plan", () => {
  test("routes modes to engine chains ending in webfetch", () => {
    expect(planFor({})).toEqual(["webfetch"])
    expect(planFor({ mode: "fast" })).toEqual(["webfetch"])
    expect(planFor({ mode: "stealth" })).toEqual(["camofox", "scrapling", "webfetch"])
    expect(planFor({ mode: "ai" })).toEqual(["scrapegraph", "webfetch"])
    expect(planFor({ mode: "channels" })).toEqual(["agent-reach", "webfetch"])
    expect(planFor({ mode: "auto" })).toEqual(["webfetch"])
  })

  test("stage 1 stub is honest about the fast tier", () => {
    const output = stubOutput({ url: "https://example.com" })
    expect(output.engine).toBe("webfetch")
    expect(output.warnings.join(" ")).toContain("fast tier")
  })

  test("stage 1 setup defers installs with a kill switch", () => {
    expect(autoSetupEnabled({})).toBe(true)
    expect(autoSetupEnabled({ OPENCODE_SCRAPER_NO_AUTOSETUP: "1" })).toBe(false)
    expect(describeAvailability({}).webfetch).toBe("ready")
    expect(describeAvailability({ OPENCODE_SCRAPER_NO_AUTOSETUP: "1" }).scrapling).toBe("disabled")
  })

  test("bridges parse without network", () => {
    expect(agentReachArgs({ url: "https://example.com" })).toEqual(["get", "web", "https://example.com", "--json", "--no-cache"])
    expect(parseAgentReach("https://example.com", JSON.stringify({ content: "hello", url: "https://example.com/x" }))).toEqual({
      output: "hello",
      finalUrl: "https://example.com/x",
    })
    expect(serverUrl({})).toBe("http://127.0.0.1:9377")
    expect(camofoxHealthUrl({})).toBe("http://127.0.0.1:9377/health")
    expect(camofoxBridgeBackend({})).toBe("auto")
    expect(camofoxBridgeBackend({ OPENCODE_CAMOFOX_BACKEND: "python" })).toBe("python")
    expect(camofoxBackend({})).toBe("auto")
    expect(camofoxServerUrl({})).toBe("http://127.0.0.1:9377")
    expect(CAMOFOX_PY_SPEC).toBe("camoufox")
    expect(CAMOFOX_PY_BRIDGE).toBe("camofox_py.py")
    expect(camofoxPythonPayload({ url: "https://example.com" }, 90000).timeout_ms).toBe(90000)
    expect(resolveScrapegraphLLM({ env: {} })).toBeUndefined()
    expect(
      resolveScrapegraphLLM({ env: {}, provider: { baseURL: "http://127.0.0.1:20128/v1", apiKey: "sk-test", model: "opencode-9router" } })?.apiKey,
    ).toBe("sk-test")
    expect(
      resolveScrapegraphLLM({ env: { OPENCODE_SCRAPEGRAPH_LLM: JSON.stringify({ model: "m", api_key: "k" }) } })?.model,
    ).toBe("m")
    expect(authHeaders({ CAMOFOX_ACCESS_KEY: "k" })).toEqual({ Authorization: "Bearer k" })
    expect(fetchPayload({ url: "https://example.com" }).url).toBe("https://example.com")
    expect(parseCamofox("https://example.com", { html: "<p>Hi</p>", finalUrl: "https://example.com/", title: "T" }).title).toBe("T")
    expect(() => parseCamofox("https://example.com", {})).toThrow()
    expect(() => engineTest.assertHttpUrl("ftp://x")).toThrow()
    expect(engineTest.scrapegraphProviderFromEnv().baseURL).toContain("20128")
    expect(engineTest.toOutput({ url: "https://example.com" }, "<title>Hi</title><p>Hello</p>", "webfetch", "https://example.com", Date.now()).title).toBe("Hi")
  })
})

