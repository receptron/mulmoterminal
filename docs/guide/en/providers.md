---
title: Using another model via OpenRouter
layout: default
parent: English
nav_order: 5
---

# Using another model via OpenRouter
{: .no_toc }

- TOC
{:toc}

Claude Code can talk to any **Anthropic-compatible** backend. MulmoTerminal reads those backends from
its config, their **keys from the environment the server was started with**, and lets you choose a
model per session — so Kimi, DeepSeek, GLM, Gemini, GPT or Grok run in the same terminal you already use.

This page walks through **OpenRouter** end to end, from the first setup to adding models of your own.
Moonshot, a company LiteLLM gateway, or any other Anthropic-compatible backend follows the same steps.

---

## The shape of it

Configuration lives in **three places**, each for a reason:

| What | Where | Why there |
|---|---|---|
| **The backend** (URL, name of the key variable) | `providers` in `~/.mulmoterminal/config.json` | shared by the whole app. **Nothing ships built in — without this, there is nothing to choose** |
| **The API key** | the server's environment (`.env`) | **that config file is served to the browser and the phone** — a key must never be in it |
| **The default model** | a project's `.mulmoterminal.json` | it differs per project |

On top of that, you can **pick per session at launch** — without rewriting the default.

---

## 1. Get an OpenRouter key

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Issue an API key under [Keys](https://openrouter.ai/settings/keys) (`sk-or-…`)
3. Add credit — usage-based, and some models below are $0.08 per million input tokens

**Also check** your [privacy settings](https://openrouter.ai/settings/privacy). If they exclude every
provider serving a model, that model answers `404 No endpoints available`. The rows marked *unreachable*
in the table below hit exactly that — **not a defect in the model**.

---

## 2. Register the backend (**required**)

**Without this, there is no MODEL select at all.** No backend ships with the app.

The 27 measured models are built in, but what they carry is only the model **id and its measurements**.
**Where to send requests (`baseUrl`) and which environment variable holds the key (`tokenEnv`) are not
in them**, so until a provider is registered there is nowhere to send anything. Measured:

| `providers` | Models offered | MODEL select |
|---|---|---|
| unset (fresh install) | **0** | hidden |
| registered | **27** | shown |

### Add it in one command
{: .no_toc }

Adds the provider without disturbing the rest of your config — it backs the file up to
`config.json.bak` first, and running it twice does not duplicate the entry.

```bash
node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const file = path.join(os.homedir(), ".mulmoterminal", "config.json");
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
config.providers = [
  ...(config.providers ?? []).filter((p) => p.id !== "openrouter"),
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", tokenEnv: "OPENROUTER_API_KEY", maxOutputTokens: 16000 },
];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
console.log("added openrouter to " + file);
'
```

### Or write it by hand
{: .no_toc }

If `~/.mulmoterminal/config.json` does **not** exist yet, paste this as the whole file:

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}
```

**If the file already exists, add the `providers` key inside the existing `{ … }` — do not replace the
file.** Replacing it drops your `cwdPresets`, header buttons and everything else.

```json
{
  "cwdPresets": [ ... keep yours ... ],
  "chips": [ ... keep yours ... ],

  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}
```

### Or ask an LLM
{: .no_toc }

In any directory, tell a Claude session `add OpenRouter to my mulmoterminal config`. The bundled
`mulmoterminal-config` skill keeps your existing settings and writes a valid entry — **without your
key in it**.

**Do not list models here.** Registering a provider with this `id` is enough — the
[27 measured models](#verified) appear in the picker on their own. You only list models to add ones
that are **not** in that list (→ [Adding models](#add-models)).

| Key | Meaning |
|---|---|
| `id` | the name other settings refer to; letters, digits and `. _ : / - ~` |
| `label` | what the picker shows |
| `baseUrl` | **no trailing `/v1`** — see below |
| `tokenEnv` | the **name** of the environment variable holding the key, never the key |
| `maxOutputTokens` | optional; defaults to 16000 |
| `models` | optional; only to add models **not** in the built-in list (→ [Adding models](#add-models)) |

### Never end `baseUrl` in `/v1`
{: .no_toc }

Claude Code appends `/v1/messages` itself, so `https://openrouter.ai/api/v1` produces
`…/v1/v1/messages` and every request 404s. MulmoTerminal rejects it before launching and says why.

### Do not lower `maxOutputTokens`
{: .no_toc }

Starved of output headroom, a thinking model spends its whole budget thinking and returns **empty**
visible text — which reads as a hung session. Keep it at 16000 or above.

---

## 3. Put the key in the server's environment

In the shell that starts MulmoTerminal, or a `.env` beside it:

```bash
OPENROUTER_API_KEY=sk-or-…
```

**Never put it in the config file.** `config.json` is served to the browser and the phone through
`GET /api/config` — that is exactly why `tokenEnv` is a variable *name*.

**Restart the server** afterwards; the environment is read at startup.

A provider whose key cannot be resolved **refuses to start the session**. Quietly falling back to
Anthropic would send that session's prompts to a backend the directory never selected.

---

## 4. Use it

### Choose at launch

Once at least one provider is usable, the empty cell's launch form grows a **MODEL** select.

- The choice applies to **that session only**
- It does not rewrite `.mulmoterminal.json`
- Choosing nothing keeps the directory's default

Once the session runs, the **badge on the header's first row** shows the running model and how full
its context is — `Kimi K2.7 Code · ctx 12%`. If you don't see it, check that `ctx` is in your `chips`.

### Make it a project default

In that project's `.mulmoterminal.json`:

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

Omit `provider` and give only `model` to pick a different model **on Anthropic itself**.

Ids may contain letters, digits and `. _ : / - ~` — the same rule as a provider's `id`, so
OpenRouter's "always the latest" aliases such as `~anthropic/claude-opus-latest` work too. A value shaped
differently (whitespace, a leading dash) makes sessions in that directory **refuse to start**, rather
than quietly running on some other model. The directory's other settings still load.

### What happens on resume
{: .no_toc }

- A model **picked at launch** is kept when that session resumes (for as long as the server runs)
- A **`.mulmoterminal.json` default** is live like every other field there — edit it and the next launch uses it

---

## 5. Adding models {#add-models}

Models outside the built-in presets work too.

### List them in the config
{: .no_toc }

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "models": ["qwen/qwen3-coder", "inception/mercury-coder"]
    }
  ]
}
```

They appear in the picker marked **`not tested`** — meaning we have not checked them, which is more
honest than implying we had.

Model ids are the `vendor/model` strings shown on each model's page at
[openrouter.ai/models](https://openrouter.ai/models).

### Or ask an LLM to configure it
{: .no_toc }

If you would rather not edit JSON, ask a Claude session in any directory:

> set up OpenRouter in my mulmoterminal config

The bundled `mulmoterminal-config` skill knows this file's shape and the tested model list, and writes
a valid config — **without ever writing your key into it**.

### Measure whether a model actually works
{: .no_toc }

**Answering a prompt and driving Claude Code are different things.** Measured here, some models replied
fluently and never called a tool once — one printed `Read(file_path=…)` as prose instead of using it.

So a probe that **cannot** be completed by talking — read one file, write another — runs through the
real spawn path:

```bash
yarn tsx scripts/model-trials.ts --provider openrouter --trials 3 qwen/qwen3-coder
```

```
3/3    16s    qwen/qwen3-coder
```

Two models flipped between pass and fail across runs, so this records a **ratio, not a verdict**. The
numbers in the built-in presets (`common/modelPresets.ts`) were measured the same way.

---

## Measured models {#verified}

As of 2026-07-22, from a single OpenRouter account. **Passed** is how many attempts completed the
tool-using probe above; **median** is over the attempts that passed; price is per million input / output
tokens.

| Model id | Name | Passed | Median | Context | Price (in/out) |
|---|---|---|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | Nemotron 3 Super 120B | 3/3 | 18s | 1M | $0.08 / $0.45 |
| `qwen/qwen3-235b-a22b-2507` | Qwen3 235B A22B | 3/3 | 16s | 262k | $0.09 / $0.55 |
| `minimax/minimax-m2.7` | MiniMax M2.7 | 3/3 | 16s | 205k | $0.25 / $1 |
| `deepseek/deepseek-v3.2` | DeepSeek V3.2 | 3/3 | 42s | 164k | $0.269 / $0.4 |
| `minimax/minimax-m3` | MiniMax M3 | 3/3 | 14s | 1M | $0.3 / $1.2 |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | 3/3 | 20s | 1M | $0.435 / $0.87 |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | 3/4 | 26s | 1M | $0.094 / $0.188 |
| `openai/gpt-oss-120b` | GPT-OSS 120B | 3/4 | 18s | 131k | $0.037 / $0.17 |
| `moonshotai/kimi-k2-0905` | Kimi K2 0905 | 3/3 | 18s | 262k | $0.6 / $2.5 |
| `moonshotai/kimi-k2-thinking` | Kimi K2 Thinking | 3/3 | 20s | 262k | $0.6 / $2.5 |
| `moonshotai/kimi-k2.6` | Kimi K2.6 | 3/3 | 46s | 262k | $0.684 / $3.42 |
| `z-ai/glm-5.2` | GLM 5.2 | 3/3 | 21s | 1M | $0.819 / $2.574 |
| `moonshotai/kimi-k2.7-code` | Kimi K2.7 Code | 3/3 | 14s | 262k | $0.82 / $3.75 |
| `moonshotai/kimi-k3` | Kimi K3 | 3/3 | 29s | 1M | $3 / $15 |
| `tencent/hy3` | Tencent Hy3 | 3/3 | 17s | 262k | $0.14 / $0.58 |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra 550B | 3/3 | 13s | 512k | $0.6 / $3.6 |
| `google/gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | 3/3 | 11s | 1M | $0.3 / $2.5 |
| `amazon/nova-2-lite-v1` | Nova 2 Lite | 2/3 | 20s | 1M | $0.3 / $2.5 |
| `openai/gpt-5.6-luna` | GPT-5.6 Luna | 3/3 | 27s | 1M | $1 / $6 |
| `openai/gpt-5.6-luna-pro` | GPT-5.6 Luna Pro | 3/3 | 69s | 1M | $1 / $6 |
| `google/gemini-3.6-flash` | Gemini 3.6 Flash | 3/3 | 16s | 1M | $1.5 / $7.5 |
| `x-ai/grok-4.5` | Grok 4.5 | 3/3 | 13s | 500k | $2 / $6 |
| `openai/gpt-5.6-terra-pro` | GPT-5.6 Terra Pro | 3/3 | 38s | 1M | $2.5 / $15 |
| `meta-llama/llama-4-maverick` | Llama 4 Maverick | **0/4** | — | 1M | $0.2 / $0.8 |
| `qwen/qwen3.7-plus` | Qwen3.7 Plus | unreachable * | — | 1M | $0.32 / $1.28 |
| `mistralai/mistral-medium-3-5` | Mistral Medium 3.5 | unreachable * | — | 262k | $1.5 / $7.5 |
| `mistralai/devstral-2512` | Devstral 2512 | unreachable * | — | 262k | $0.4 / $2 |

\* **unreachable** — the account used for the measurement had every serving provider excluded by its
[privacy settings](https://openrouter.ai/settings/privacy). **Not a defect in the model**; another
account may run it fine.

**`meta-llama/llama-4-maverick` passed 0 of 4.** It connects and replies, but never calls a tool. It
stays in the list rather than being dropped, so "what about that one?" is answered with a measurement
instead of silence.

If you are unsure where to start, try **Kimi K2.7 Code** (fast, coding-oriented) or
**Nemotron 3 Super 120B** (cheap).

---

## When it doesn't work

| Symptom | Cause and fix |
|---|---|
| Refuses to start, saying `OPENROUTER_API_KEY` is needed | the key isn't in the server's environment — add it to `.env` and restart |
| Every request 404s | `baseUrl` ends in `/v1` |
| `404 No endpoints available …` | that model is excluded by your [privacy settings](https://openrouter.ai/settings/privacy) |
| Empty replies, looks hung | `maxOutputTokens` too low — keep it at 16000+ |
| Talks but never uses tools | the model's own limitation — check the table or `model-trials.ts` |
| No MODEL select in the launch form | no provider is registered (step 2) or its key is missing; "Use another model…" in the form names what's missing |
| No model in the header | `ctx` is not in your `chips` |
| Can't start under the Docker sandbox | **not supported together.** The container inherits no environment, so the session would run against Anthropic instead of the backend you picked — it is refused rather than downgraded |

---

## What protects the key

- The key is **never stored in a config file** — only the name of the variable is
- It reaches the session through a **0600 file**, not a command-line argument, so `ps` doesn't expose it to other users on the machine
- An unresolvable key **refuses the launch**, so prompts never reach an unintended backend
- `ANTHROPIC_API_KEY` is **removed** from a provider session's environment — left in place it would outrank the auth token

---

← [back to Configuration](config.html) / [English guide index](index.html)
