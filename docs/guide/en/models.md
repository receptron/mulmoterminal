---
title: Models and backends
layout: default
parent: English
nav_order: 6
---

# Models and backends
{: .no_toc }

- TOC
{:toc}

Which model a session runs on, and what credentials or permissions each route needs.
For how to write the settings, see [Configuration](config.html#providers) — this page is the
other half: what actually happens when a session starts.

Configure nothing and sessions stay on Anthropic, on Claude Code's own default model.

---

## What decides, and in what order

| What decides | Where you write it | How far it reaches |
|---|---|---|
| **The directory's default** | `provider` / `model` in `<project>/.mulmoterminal.json` | every session opened in that directory |
| **The launch pick** | the **MODEL** field in an empty cell's launch form | **that one session only** — the file is not rewritten |
| Nothing at all | — | Anthropic, on Claude Code's default model |

- **A new session** takes the launch pick when there is one, otherwise the directory's default.
- **A resume** IGNORES the launch pick and continues on **the backend that session started on**.
  That memory is process-lifetime only, so after a server restart a resumed session falls back
  to the directory's default.

> **Why a resume ignores the pick**
> The browser re-sends whatever its cell still holds on every reconnect, and that value belongs to
> the session that cell launched — not necessarily to the one being resumed. A backend swapping
> mid-conversation is the worse outcome, so what the session actually started on wins.

`provider` and `model` always travel as a **pair**. Neither is ever taken from one source and
combined with the other from somewhere else: a dropped provider whose model survived would send
another vendor's model id to Anthropic.

---

## Staying on Anthropic (the default)

### Authentication

MulmoTerminal holds no Anthropic credential of its own — it uses **whatever the `claude` command
is already authenticated with**. If `claude` runs in your terminal, nothing else is needed.

Claude Code's own precedence, strongest first:

1. `ANTHROPIC_API_KEY`
2. `ANTHROPIC_AUTH_TOKEN`
3. the subscription OAuth credential (on macOS, the `Claude Code-credentials` Keychain entry)

**A leftover `ANTHROPIC_API_KEY` silently outranks the other two.** That is usually the answer to
"I'm logged in, so why am I being billed per token?" and "why did my provider session go to
Anthropic anyway?". For provider sessions MulmoTerminal removes it explicitly — see below.

### Running a different Anthropic model

Put `model` in `.mulmoterminal.json` and leave `provider` out.

```json
{ "model": "sonnet" }
```

The value is passed to `claude --model` verbatim, so an alias (`sonnet` / `opus` / `haiku`) and a
full model id are equally fine.

> **The launch form's MODEL field does not list Anthropic models.**
> It offers the models of the backends registered in `config.json` under `providers`, and with no
> provider registered **the field does not appear at all** (a link to the setup help takes its
> place). Today, `model` in `.mulmoterminal.json` is the only way to change the Anthropic model.

---

## Running on another backend (providers)

For the registration steps see [Configuration → Running on another model](config.html#providers).
What follows is how such a session is actually started.

### What reaches the session

A provider session receives these through the `env` block of Claude Code's settings (`--settings`):

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `baseUrl` | where to connect |
| `ANTHROPIC_AUTH_TOKEN` | the **value** of the env var named by `tokenEnv` | authentication |
| `ANTHROPIC_MODEL` | the chosen model id | |
| `ANTHROPIC_SMALL_FAST_MODEL` | the same model id | Claude Code makes background "haiku" calls (title generation and friends); against a backend with no haiku they 400, so they are aimed at the same model |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `maxOutputTokens` (**16000** when omitted) | a thinking model starved of output room spends the budget thinking and returns **empty** visible text |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | a redirected session must not keep calling the real Anthropic API in the background |
| `ANTHROPIC_API_KEY` | **removed from the environment** | left in place it silently outranks the auth token, sending the session somewhere nobody chose |

The settings `env` block is the transport rather than the process environment because **Claude Code
applies it itself**, so it reaches the session identically on the host, in a tmux pane, and inside a
container.

Settings carrying a token are written to `~/.mulmoterminal/settings/<session-id>.json` with mode
`0600` and only the PATH reaches the command line, so the token is not visible to other users
through `ps`. The file is removed when the session ends.

### No key, no launch

If the env var named by `tokenEnv` is empty or unset, the session **refuses to start**.

```
provider 'openrouter' needs OPENROUTER_API_KEY in the server's environment — refusing to start
```

It does not quietly fall back to Anthropic, because **a base URL with no token does not disable
Claude Code's authentication — it sends your subscription credential to that third party**.
Stopping is the safe answer.

### If you use tmux

A tmux pane inherits the environment of the **tmux server**, not of the client that spawned it. So
before a provider session starts, MulmoTerminal strips `ANTHROPIC_API_KEY` from the tmux server's
global environment — otherwise an earlier non-provider session could seed the server with the key
and every provider pane after it would inherit the thing that outranks its auth token.

---

## Credentials and permissions you need

| To do this | You need | Where it goes |
|---|---|---|
| **Stay on Anthropic** | `claude` to be authenticated | managed by Claude Code itself; MulmoTerminal does not touch it |
| **Use a provider** | that service's API key | an **environment variable of the shell that starts the server**, or a `.env` beside it — never the config file |
| **Use OpenRouter** | your account's data policy to allow the serving providers | [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy) |
| **Change the tool-permission level** | `CLAUDE_PERMISSION_MODE` | the server's environment at startup |
| **Run in the Docker sandbox** | macOS + a running Docker | `MULMOTERMINAL_SANDBOX=1`. **Cannot be combined with a provider** |

Keys are always referenced **by name**: what goes in `config.json` is `tokenEnv`, the NAME of an
environment variable, never its value. This config is served over HTTP to the browser and the phone,
so there is deliberately nowhere to put a secret in it.

Adding an environment variable requires **restarting the server**.

### Tool permissions (`CLAUDE_PERMISSION_MODE`)

Claude sessions are spawned with `--permission-mode`. The default is **`auto`**, so a backend
session runs hands-off. Override it in the server's environment:

```bash
CLAUDE_PERMISSION_MODE=default npx mulmoterminal@latest
```

`default` / `acceptEdits` / `bypassPermissions` / `plan` and friends can be passed through.

### The macOS Keychain (sandbox only)

With `MULMOTERMINAL_SANDBOX=1`, MulmoTerminal reads the `Claude Code-credentials` Keychain entry to
hand the container the current credential — a container cannot read the Keychain, and
`~/.claude/.credentials.json` is often absent or stale. macOS may ask you to allow that access. If
the token has expired it drives the host `claude` to refresh it first.

Ordinary sessions running on the host never take this route.

---

## Choosing at launch

When at least one provider is usable, an empty cell's launch form grows a **MODEL** field.

```
Kimi K2.7 Code · 3/3 · 14s · 262k
```

Those numbers are measured (`3/3` = tool-using task completed / attempts, `14s` = median,
`262k` = context length). How to read them, and how they were produced, is in
[Configuration → Choosing at launch](config.html#providers).

A provider that **cannot** be used — a missing key, for instance — is not offered. The help beside
the field carries the very sentence a session would have refused with, naming the single thing to
fix. Fix it and restart the server.

---

## When it doesn't work

| Symptom | Cause | Fix |
|---|---|---|
| `... needs XXX_API_KEY in the server's environment` | the key is not in the server's environment | put it in the shell or `.env`, restart the server |
| `unknown provider 'xxx'` | `provider` in `.mulmoterminal.json` matches no `providers` entry in `config.json` | make the ids agree |
| `provider 'xxx' needs a model` | a provider was named with no model | add `model` to `.mulmoterminal.json` |
| `has an unusable baseUrl` | not `http(s)://`, or it ends in `/v1` | drop the `/v1` — Claude Code appends `/v1/messages` itself |
| 404s from the backend | same as above (`/v1/v1/messages`) | drop the `/v1` from `baseUrl` |
| the reply comes back **empty** | a thinking model with too little output room | raise `maxOutputTokens` (default 16000) |
| a resumed session isn't on the model you picked | by design: a resume continues on the backend it started on | start a new session instead |
| after a server restart, resumed sessions fall back to the default | that memory is process-lifetime only | expected; put the default in `.mulmoterminal.json` |
| `cannot run in the Docker sandbox yet` | a provider combined with the sandbox | drop one of the two |
| the picker says `not reachable from this account` | the OpenRouter account used for the measurement had every serving provider excluded by its privacy settings | **not a defect in the model** — it may well run on your account |

The model list is `common/modelPresets.ts`; the measurement script is `scripts/model-trials.ts`.
