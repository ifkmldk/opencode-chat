export * as Secrets from "./secrets.js"

// fork: child processes (agent shell, PTY) must not inherit the server's provider keys and tokens. A page, a file or a
// search result that talks the model into running `env` would otherwise hand them over. Variables the owner sets for a
// session on purpose (session environment) are not touched; only the server's own environment is scrubbed.
//
// Names allowed through on purpose: OPENCODE_CHILD_ENV_PASSTHROUGH=GITHUB_TOKEN,NPM_TOKEN (comma separated).

const SECRET_NAME =
  /(^|_)(API_?KEY|ACCESS_?KEY|SECRET(_?KEY)?|PASSWORD|PASSWD|PRIVATE_?KEY|TOKEN|CREDENTIALS?|AUTH(_?TOKEN)?|COOKIE|SESSION_?KEY)(_|$)/i
const PROVIDER_PREFIX = /^(OPENCODE_(?!TERMINAL|CHANNEL|DISABLE|CONFIG|SCRAPER|OFFICE|MAPS|CAMOFOX|CLASSIFIER|LAYA|JOBS)|9ROUTER_|OPENAI_|ANTHROPIC_|GOOGLE_API|GEMINI_|AZURE_OPENAI|MISTRAL_|GROQ_|XAI_|DEEPSEEK_|OPENROUTER_|TOGETHER_|FIREWORKS_|COHERE_|PERPLEXITY_|HF_|HUGGINGFACE_)/i

export function isSecretName(name: string) {
  return SECRET_NAME.test(name) || (PROVIDER_PREFIX.test(name) && /KEY|TOKEN|SECRET|PASSWORD/i.test(name))
}

/** A copy of `env` without secret-looking variables, except the names listed in OPENCODE_CHILD_ENV_PASSTHROUGH. */
export function scrub(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set(
    (env.OPENCODE_CHILD_ENV_PASSTHROUGH ?? "")
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter(Boolean),
  )
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && (allowed.has(entry[0].toUpperCase()) || !isSecretName(entry[0]))),
  )
}
