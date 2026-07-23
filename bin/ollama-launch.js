// Pure helpers for the `claude-ollama` launcher, split out so the decisions can be tested
// without spawning ollama or claude. The launcher (bin/claude-ollama.js) keeps the I/O.

export const OLLAMA_CONTEXT_LENGTH = 32768;
export const CLAUDE_MAX_OUTPUT_TOKENS = 8000;
export const OLLAMA_AUTH_TOKEN = "ollama";

// The flags that shrink Claude Code's system prompt so a small local model isn't drowned by
// skills / plugins / MCP / hooks. Measured: ~16386 tokens without them, ~400 with — the
// difference between qwen3:4b answering generically and actually completing a tool loop.
export const MINIMAL_PROMPT_FLAGS = ["--bare", "--disable-slash-commands"];

// Parse `claude-ollama <model> [claude args…]`: the first argument is the model, the rest pass
// through to claude untouched. No model (or -h/--help) asks for help.
export function parseClaudeOllamaArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    return { help: true, model: null, claudeArgs: [] };
  }
  const [model, ...claudeArgs] = args;
  return { help: false, model, claudeArgs };
}

// The environment Claude Code needs to talk to the local Ollama server instead of Anthropic's
// cloud. ANTHROPIC_API_KEY is REMOVED, not overwritten: if it survives, Claude prefers it and
// ignores the base URL (and warns). Base env is copied so the child keeps PATH etc.
export function buildClaudeEnv(baseEnv, model, baseUrl) {
  const env = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_BASE_URL = baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN;
  env.ANTHROPIC_MODEL = model;
  // The background "small/fast" slot must resolve too, or it errors; point it at the same
  // local model (there is no local haiku).
  env.ANTHROPIC_SMALL_FAST_MODEL = model;
  // A reasoning model spends its first budget on a thinking block; a small ceiling makes the
  // first turn come back empty, so keep it generous.
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(CLAUDE_MAX_OUTPUT_TOKENS);
  return env;
}

// The environment for the dedicated `ollama serve`: a big context window (Claude's system
// prompt overflows the 4096 default and the session dies on the second turn) on a private host
// so any Ollama the user already runs is left untouched.
export function buildOllamaServeEnv(baseEnv, host, contextLength = OLLAMA_CONTEXT_LENGTH) {
  return { ...baseEnv, OLLAMA_HOST: host, OLLAMA_CONTEXT_LENGTH: String(contextLength) };
}

// The full claude argv: the prompt-shrinking flags first, then the user's pass-through args
// (last, so they can add to or override the defaults).
export function buildClaudeArgs(claudeArgs) {
  return [...MINIMAL_PROMPT_FLAGS, ...(Array.isArray(claudeArgs) ? claudeArgs : [])];
}

// Whether `model` is present in a GET /api/tags payload. Accepts the bare name too
// (`qwen3` → `qwen3:latest`), the way `ollama run` resolves an untagged name.
export function modelIsInstalled(tags, model) {
  const names = Array.isArray(tags?.models) ? tags.models.map((m) => m?.name).filter((n) => typeof n === "string") : [];
  return names.includes(model) || names.includes(`${model}:latest`);
}
