---
title: Local models with claude-ollama
layout: default
parent: English
nav_order: 6
---

# Local models with claude-ollama
{: .no_toc }

`claude-ollama` is a one-command launcher that runs Claude Code **fully locally against a
[Ollama](https://ollama.com) model** — no cloud, no API key, works offline.

> This is not the MulmoTerminal web UI — it's a standalone wrapper (bundled with the
> mulmoterminal package) that launches plain `claude` (the Claude Code CLI) pointed at Ollama.

## Prerequisites

- [Ollama](https://ollama.com/download) installed — **server 0.31 or newer** (it needs the
  native Anthropic-compatible `/v1/messages`). The **running server** version is what matters:
  `curl http://localhost:11434/api/version` — the packaged CLI can lag.
- Claude Code (`claude`) installed (`npm install -g @anthropic-ai/claude-code`).
- The model pulled (`ollama pull qwen3:4b`).

## Usage

```bash
# via npx (no install)
npx -p mulmoterminal claude-ollama qwen3:4b

# or install mulmoterminal globally
npm install -g mulmoterminal
claude-ollama qwen3:4b

# extra args pass straight through to claude
claude-ollama qwen3:30b-a3b "refactor this module"
```

## What it sets up (three things)

Ollama 0.31+ serves a native Anthropic-compatible `/v1/messages`, so pointing
`ANTHROPIC_BASE_URL` at it connects with no translation layer. But **making a small local model
actually work needs three things, which `claude-ollama` wires up for you**:

1. **A big context** — a dedicated `ollama serve` on a private free port with
   `OLLAMA_CONTEXT_LENGTH=32768`. The 4096 default overflows Claude's system prompt and the
   session dies on the second turn. **Any Ollama you already run (11434) is left untouched**, and
   the private server is stopped when you exit.
2. **A minimal system prompt** — `claude --bare --disable-slash-commands`, dropping
   skills / plugins / MCP / hooks. This shrinks the prompt from **~16000 to ~400 tokens**.
   **Without it, a small model drowns and answers generically instead of using tools** — the
   number-one reason it "doesn't work".
3. **The env recipe** — remove `ANTHROPIC_API_KEY` (if present it outranks the base URL) and set
   `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN=ollama` / `ANTHROPIC_MODEL` /
   `ANTHROPIC_SMALL_FAST_MODEL` (the same model) / `CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000`.

## Choosing a model

- **`qwen3:4b` (light) / `qwen3:30b-a3b`** complete a multi-turn tool loop (create a file, read
  it back, report) cleanly.
- **`llama3.1:8b` does not** — it returns a valid one-shot tool call but breaks inside the
  multi-turn loop (its Ollama chat template leaks an `assistant\n\n` prefix on the tool-result
  turn).
- **Validate through a real multi-turn run** — a single endpoint probe isn't enough.

## Caveats

- **Speed depends on the model and machine.** Even qwen3:4b can take tens of seconds to a few
  minutes per tool-using turn under load (it does complete).
- A fresh dedicated server reloads the model (slower first turn) but guarantees the big context.

---

← [Using another model via OpenRouter](providers.html) / [English guide index](index.html)
