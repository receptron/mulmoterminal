---
name: mulmoterminal-model
description: Run MulmoTerminal sessions on a model other than Anthropic's default — register an Anthropic-compatible backend (OpenRouter, Moonshot, a local Ollama bridge, a company gateway) as a `providers` entry in `~/.mulmoterminal/config.json`, which has no Settings UI, and pin a `provider` / `model` per project in its `.mulmoterminal.json`. Knows the measured pass rates of the built-in model list, and the four misconfigurations that break a session in ways that are hard to diagnose from inside it (a trailing `/v1`, too small an output budget, an API key written to disk, a provider named but never registered). Use when the user wants to use OpenRouter, Kimi, GLM, DeepSeek, Qwen, a local or self-hosted model, a cheaper model, or a different Anthropic model for one project — or when a session refuses to start, returns empty replies, or 404s after they changed models.
---

# Run on another model

Two files, two jobs:

- **`~/.mulmoterminal/config.json` → `providers`** — register a backend once. No Settings UI.
- **`<project>/.mulmoterminal.json` → `provider` / `model`** — what this project launches on.
  Both are defaults; the launch form can override them for a single session.

Neither is needed to use Anthropic's default. Only do this when the user asked for another model.

## Registering a backend

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

Each rule below was measured against a working setup, and each breaks the session in a way that is
hard to diagnose from inside it:

- **`baseUrl` must not end in `/v1`.** Claude Code appends `/v1/messages` itself, so a trailing
  `/v1` produces `/v1/v1/messages` and every request 404s.
- **Never write the API key into a config or skill file.** `tokenEnv` is the **name** of an
  environment variable, not the value: the key reaches the server through its environment. Put it
  in the shell that starts the server, or in a `.env` in the directory it is started from — and if
  you write a `.env`, check it is gitignored before you do. If the user pastes a key at you, tell
  them where it goes; do not store it anywhere yourself.
- **Keep `maxOutputTokens` at 16000 or above.** A thinking model given less spends the whole budget
  thinking and returns empty visible text, which reads as a hung session.
- **Do not write a `models` array** unless the user names a model outside the built-in list.
  Registering the provider is enough — every preset for that `id` appears in the picker on its own.
  `models` exists only to ADD ids nobody has measured.
- This is a **partial `POST /api/config` merge** — write only `providers`. Send the array **complete**
  (existing entries included): it replaces rather than appends.
- The server reads the environment **at startup**: after adding a key, it has to be restarted.

## Choosing a model — never invent an id

Read `common/modelPresets.ts` in the MulmoTerminal repo and offer what is listed there, **with its
measured pass rate**.

Those numbers are the point. Each entry records how many attempts of a real tool-using task the
model completed — a model can answer fluently, in good prose, and never once call a tool, and that
is indistinguishable from working until you try to get something done. `3/3` and `0/4` are the
difference between a usable session and a broken one, so quote the ratio when you offer a model.

- Prefer entries whose `trials.status` is `measured` with `passed === of`.
- `status: "unreachable"` is **not** a defect in the model — it means the account that ran the
  measurement couldn't reach it (OpenRouter answers 404 when privacy settings exclude every
  provider serving a model). Another account may run it fine; say that rather than hiding it.
- `status: "unmeasured"` means the user added it themselves. Say it is untested.
- If the user names a model that isn't listed, add it to that provider's `models` array rather than
  silently trusting it — and tell them it is unmeasured.
- `medianSeconds` is worth quoting when they care about latency: the same probe ran in 11s on one
  model and 69s on another.

## Pinning a project

```json
{ "provider": "openrouter", "model": "moonshotai/kimi-k2" }
```

| Key | Meaning |
|---|---|
| `provider` | The `id` of a backend registered in `providers`. **Omit to stay on Anthropic.** |
| `model` | Passed to `claude --model`. With no `provider`, this picks a different **Anthropic** model. |

**A directory naming a `provider` that isn't registered, or whose key is missing, does not fall
back — its sessions refuse to start.** Check the provider exists in the global config before writing
this, and check the environment variable is actually set in the shell that will run the server.

`.mulmoterminal.json` applies live: writing it with your Write/Edit tool is itself the reload
signal (there is no filesystem watcher). But a **running** session keeps the model it launched with
— reopen the cell to see the change.

## When it doesn't work

Work down this list; each maps to one of the rules above.

| Symptom | Look at |
|---|---|
| Every request 404s | A trailing `/v1` on `baseUrl` |
| Session starts, replies are empty | `maxOutputTokens` below 16000 on a thinking model |
| Session refuses to start | A `provider` id that isn't registered, or `tokenEnv` naming a variable that isn't set in the server's shell |
| Worked yesterday, not today | The key was in a shell that's gone. The server reads the environment at startup |
| Model answers but never edits files | Not a config problem — check the model's pass rate in `modelPresets.ts` |
