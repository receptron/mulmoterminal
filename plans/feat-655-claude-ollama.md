# feat(#655/#692): `claude-ollama` — run Claude Code against a local Ollama model

## What
A one-command launcher `claude-ollama <model> [claude args…]` that runs Claude Code fully
locally against an Ollama-served model. No cloud, no API key, no translation proxy — Ollama
0.31+ serves a native Anthropic-compatible `/v1/messages`.

## Why the naive recipe (#692) isn't enough — verified on-machine
- Ollama's `/v1/messages` works and big context is honoured, BUT
- Claude Code's full system prompt is ~16386 tokens (skills/plugins/MCP/hooks). Small local
  models (qwen3:4b, qwen3:30b-a3b) drown in it and answer generically instead of using tools.
- `claude --bare --disable-slash-commands` cuts the prompt to ~400 tokens → qwen3:4b then
  completes a multi-turn tool loop (create file → read back → report). This piece was missing
  from #692.

## The launcher absorbs three things
1. **Big context**: a dedicated `ollama serve` on a private free port with
   `OLLAMA_CONTEXT_LENGTH=32768` (4096 default dies on turn 2).
2. **Minimal prompt**: `--bare --disable-slash-commands` on the claude invocation.
3. **Env recipe**: unset `ANTHROPIC_API_KEY`; set `ANTHROPIC_BASE_URL`,
   `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`,
   `CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000`.

## Files
- `bin/ollama-launch.js` (+ `.d.ts`): pure, testable — arg parsing, env building, flag list,
  model-installed check.
- `bin/claude-ollama.js`: I/O — check ollama/claude on PATH, pick a free port, start the
  big-context server, wait ready, verify the model is pulled, spawn claude, clean up on exit.
- `package.json`: add the `claude-ollama` bin.
- `test/bin/ollama-launch.spec.ts`: pure-function tests + mutation checks.
- `docs/guide/{ja,en}/providers.md`: a section (usage, the 3-point recipe, caveats).

## Caveats to document
- Speed is model/hardware dependent (qwen3:4b ~1–2 min/turn under load here; it completes).
- Model choice matters — validate through a real multi-turn run (llama3.1:8b breaks its
  tool-result turn per #692). qwen3 works.
- A fresh dedicated server reloads the model (first turn slower) but guarantees the big context.

## Not in scope
- Integrating Ollama as a first-class provider inside the mulmoterminal web UI (that's the
  broader #655; this launcher is the focused, verified first step).
