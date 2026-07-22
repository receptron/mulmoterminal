// Which model a session runs, and — when a directory points at an Anthropic-compatible
// third party (OpenRouter, Moonshot, a LiteLLM gateway) — the environment that aims
// Claude Code there (#579).
//
// Every rule here was measured against a working setup, not inferred from the docs:
//
//   - The token is NOT optional. Claude Code's auth precedence puts ANTHROPIC_AUTH_TOKEN
//     above the subscription OAuth credential, but a base URL with NO token falls all the
//     way through to that credential — and sends it to the third party. So a provider
//     whose token cannot be resolved must REFUSE to launch, never quietly fall back.
//   - ANTHROPIC_SMALL_FAST_MODEL has to be set too. Claude Code makes background "haiku"
//     calls (title generation and friends); against a backend with no haiku they 400.
//   - Thinking models need output headroom. Starved of it they spend the whole budget
//     thinking and return empty visible text, which reads as a hung session.
//   - ANTHROPIC_API_KEY must be UNSET, not empty — a leftover value silently outranks the
//     auth token. It cannot be expressed here as a value, hence `unset`.

export interface ProviderConfig {
  id: string;
  label: string;
  // What Claude Code hits. WITHOUT a trailing /v1: the CLI appends /v1/messages itself.
  baseUrl: string;
  // The NAME of the env var holding the key, never the key. The value is read from the
  // server's own environment, so no secret is stored in a config file the app serves.
  tokenEnv: string;
  maxOutputTokens?: number;
}

export interface DirModelChoice {
  provider: string | null;
  model: string | null;
}

export interface ProviderResolution {
  // Passed as `claude --model`, which outranks both the settings `model` and
  // ANTHROPIC_MODEL. Null when the directory names no model.
  model: string | null;
  // Goes in the settings file's `env` block, which Claude Code applies itself — so it
  // reaches the session identically on the host, under tmux, and in a container.
  env: Record<string, string>;
  // Names to remove from the spawned process's environment (see ANTHROPIC_API_KEY above).
  unset: string[];
}

export type ProviderResult = { ok: true; value: ProviderResolution } | { ok: false; reason: string };

// Enough room for a thinking model to think AND answer. Below this the visible text
// comes back empty.
export const DEFAULT_MAX_OUTPUT_TOKENS = 16000;

// Claude Code appends /v1/messages, so a base URL that already ends in /v1 produces
// /v1/v1/messages and 404s. Caught here rather than at request time, where it surfaces
// as an unexplained failure inside the session.
export const isUsableBaseUrl = (baseUrl: string): boolean => /^https?:\/\/\S+$/.test(baseUrl) && !/\/v1\/?$/.test(baseUrl);

const NOTHING: ProviderResolution = { model: null, env: {}, unset: [] };

const providerEnv = (provider: ProviderConfig, model: string, token: string): Record<string, string> => ({
  ANTHROPIC_BASE_URL: provider.baseUrl,
  ANTHROPIC_AUTH_TOKEN: token,
  ANTHROPIC_MODEL: model,
  // The background "haiku" calls go to the same model — the backend has no haiku.
  ANTHROPIC_SMALL_FAST_MODEL: model,
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(provider.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
  // A redirected session must not keep calling the real Anthropic API in the background.
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
});

// What a session in this directory should run, or why it must not start.
//
// `sandbox` refuses the combination outright: the container inherits no environment and
// cannot reach a loopback gateway, so a sandboxed provider session would silently run
// against Anthropic instead of where the directory asked for.
export function resolveProvider(
  choice: DirModelChoice,
  providers: readonly ProviderConfig[],
  env: NodeJS.ProcessEnv,
  sandbox: boolean = false,
): ProviderResult {
  if (!choice.provider) {
    // No provider named: stay on Anthropic, honour a bare model choice.
    return { ok: true, value: { ...NOTHING, model: choice.model } };
  }
  const provider = providers.find((candidate) => candidate.id === choice.provider);
  if (!provider) return { ok: false, reason: `unknown provider '${choice.provider}' — add it to config.json under "providers"` };
  if (sandbox) return { ok: false, reason: `provider '${provider.id}' cannot run in the Docker sandbox yet` };
  if (!isUsableBaseUrl(provider.baseUrl)) {
    return { ok: false, reason: `provider '${provider.id}' has an unusable baseUrl '${provider.baseUrl}' — an http(s) URL without a trailing /v1` };
  }
  if (!choice.model) return { ok: false, reason: `provider '${provider.id}' needs a model — set "model" in .mulmoterminal.json` };
  const token = env[provider.tokenEnv];
  if (!token) {
    return { ok: false, reason: `provider '${provider.id}' needs ${provider.tokenEnv} in the server's environment — refusing to start` };
  }
  return { ok: true, value: { model: choice.model, env: providerEnv(provider, choice.model, token), unset: ["ANTHROPIC_API_KEY"] } };
}

// A directory asked for a backend that cannot be honoured. Thrown rather than downgraded:
// staying on Anthropic would send the session's prompts to a backend the directory did
// NOT select, which is the failure this whole module exists to prevent.
export class ProviderRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ProviderRefusedError";
  }
}

// The resolution, or a throw. Callers get no third option — a `{ ok: false }` that a
// caller can quietly ignore is how the contract above gets lost.
export function requireResolution(result: ProviderResult): ProviderResolution {
  if (!result.ok) throw new ProviderRefusedError(result.reason);
  return result.value;
}

// Apply a resolution's `unset` to an environment copy. The settings `env` block can set
// a variable but not remove one, so removal has to happen on the process environment.
export function withoutUnset(env: NodeJS.ProcessEnv, unset: readonly string[]): NodeJS.ProcessEnv {
  if (unset.length === 0) return env;
  const removed = new Set(unset);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !removed.has(name)));
}
