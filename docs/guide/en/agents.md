---
title: Which coding agent
layout: default
parent: English
nav_order: 7
description: Every coding agent a MulmoTerminal cell can run — Claude Code, Codex, Antigravity, Grok, Muse, GitHub Copilot CLI and Cursor CLI — what each one needs installed, how it resumes a conversation, how it reaches the GUI tools, and how to run Claude Code through a backend or a command line of your own.
---

# Which coding agent

A cell runs **one agent**, chosen in the **Agent Picker** at the top of an empty cell. Seven agents
are first-class, plus **Shell**, which is not an agent at all.

They are not interchangeable. Each keeps its conversations in its own place, so **only the agent
that wrote a conversation can continue it** — switching the picker changes which "or resume here"
list you see. And they reach the GUI tools three different ways, which is the part most worth
reading before you pick one.

---

## The seven agents at a glance {#at-a-glance}

| | Agent Picker | Command | Badge | GUI tools reach it by | Model override |
|---|---|---|---|---|---|
| **Claude Code** | Claude *(default)* | `claude` | — | a per-session URL | the Model picker, or a `providers` entry |
| **Codex** | Codex | `codex` | `cx` | a per-session URL | `CODEX_MODEL` |
| **Antigravity** | Antigravity | `agy` | `agy` | a file in the directory | `ANTIGRAVITY_MODEL` |
| **Grok** | Grok | `grok` | `gk` | a file in the directory | `GROK_MODEL` |
| **Muse** | Muse | `muse` | `mu` | a plugin, per machine | `MUSE_MODEL` |
| **GitHub Copilot CLI** | Copilot | `copilot` | `cp` | a per-session URL | `COPILOT_MODEL` |
| **Cursor CLI** | Cursor | `cursor-agent` | `cu` | a file in the directory *(not written for you yet)* | `CURSOR_MODEL` |

Every command can be pointed elsewhere with `CLAUDE_BIN` / `CODEX_BIN` / `ANTIGRAVITY_BIN` /
`GROK_BIN` / `MUSE_BIN` / `COPILOT_BIN` / `CURSOR_BIN` — a pinned version, a wrapper, a path
outside `PATH`.

**Which ones tell you when they finish.** Claude and Cursor drive both the working dot and the
finished one, so a cell you are not looking at raises the attention mark and plays the sound.
Codex and Copilot drive the working half only. Antigravity, Grok and Muse drive neither — their
cells run fine and simply stay quiet. Only Claude can also tell you it is **blocked waiting for
you**; for every other agent an approval prompt sits in the cell without a sound.

Nothing has to be installed for an agent you do not use. An agent whose command is missing simply
fails to start that cell; the others are unaffected.

---

## How each one reaches the GUI tools {#gui-tools}

This is the real difference between them. "GUI tools" are MulmoTerminal's own MCP tools — the ones
that draw a chart in the Canvas, read the workspace's data, and so on, grouped as
`render` / `data` / `media` / `external`.

There are **three routes**, and which one an agent takes is a property of the agent's CLI, not a
setting you can change.

### 1. A per-session URL — Claude Code, Codex and Copilot

In the **workspace**, these three are handed **every tool** on one generated URL, per session.
There is nothing to register and nothing to switch on: the launcher form does not even show the
tool-group toggles there, because they would not add anything.

In a **project directory** they are handed only the groups that directory registered — still on a
per-spawn flag, not by reading the file route 2 uses.

### 2. A file in the directory — Antigravity, Grok and Cursor

None of these can be handed a URL at spawn, so each reads a **config file in the directory** and
gets whatever that file registers — in the workspace too.

- **Antigravity** reads a JSON file MulmoTerminal writes from the directory's toggles, and rewrites
  whenever a toggle flips. Servers it did not write are left alone, and the file is kept out of
  `git status`.
- **Grok** reads `.grok/config.toml`, which is yours — so MulmoTerminal drives `grok mcp add`
  rather than editing the file itself.
- **Cursor** reads `.cursor/mcp.json`, which MulmoTerminal writes from the directory's toggles —
  **when a cursor cell starts there**, not when you flip the switch. (Antigravity's file is rewritten
  on the flip; cursor's is not, so a directory gets the file the first time you actually run cursor
  in it.) Either way the change reaches the NEXT session, never one already running. Cursor then
  needs one step neither of the others does: it will not load a server it has not **approved**, and
  an unapproved one is *silently absent* rather than prompted for — so each entry MulmoTerminal wrote
  is approved through `cursor-agent mcp enable` as the cell starts. Your own entries in that file are
  left exactly as you wrote them, and the file is kept out of `git status` only when MulmoTerminal
  created it.

So with Antigravity, Grok or Cursor picked, the four toggles stay visible in the launcher form even
in the workspace. That is the truthful answer: the directory's file is the only way these three get
any GUI tools.

### 3. A plugin, per machine — Muse *(new in 4.7.0)* {#muse-plugin}

Muse has no way to take a URL and no per-directory config either. Its MCP servers are declared by
an installed **plugin**, and `muse plugins install` records one **per machine** — installing from
one directory does not register anything in that directory.

So MulmoTerminal registers **one plugin holding all four group servers**, and narrows each
**session** back to what its directory switched on. The plugin is installed and approved through
Muse's own CLI, and an unchanged plugin spawns no subprocess at all.

A group the session is not entitled to serves an **empty toolset** rather than an error — otherwise
a cell that switched one group on would show three broken servers.

Two consequences worth knowing:

- **The plugin is machine-wide.** It appears in `muse plugins list` for every Muse session on the
  machine, including ones MulmoTerminal did not start. Those resolve to no session and serve
  nothing. Remove it with `muse plugins remove mulmoterminal`; the next Muse cell re-registers it.
- **Muse's plugin support is behind an experimental flag** of Muse's own. If a future Muse build
  renames or drops it, a Muse cell still starts — it just has no GUI tools, with one warning.

---

## Resuming a conversation {#resume}

**OR RESUME HERE** lists conversations in the current directory *for the agent the picker has
selected*. Each agent keeps its own store, so the lists never mix.

| | Where the conversation lives |
|---|---|
| Claude Code | its own transcript directory |
| Codex | a rollout file it writes per session |
| Antigravity | its own conversation store |
| Grok | its own store, keyed by directory |
| Muse | a SQLite session index plus a session log |
| GitHub Copilot CLI | `~/.copilot/session-state/<id>/`, with a machine-wide SQLite index |
| Cursor CLI | `~/.cursor/projects/<slug>/agent-transcripts/<id>/` |

A resumed Muse session keeps its `--workspace`, which is what registers its workspace tools — a
resume that dropped it came back with the conversation and without the tools (fixed in 4.7.0).

**A Muse resume takes no seed prompt.** Muse does not accept a prompt on a resume command line, so
a seed is only sent on a fresh session.

---

## The header badges

A non-Claude cell wears a short badge (`cx`, `agy`, `gk`, `mu`, `cp`, `cu`) so you can tell at a glance what a
cell is running. Beside it the header shows the model and how full the context is, and the
up/down arrows are the session's token usage.

For Muse the context reading is the **last completed call**, not the largest ever seen — a
high-water mark never came down after a compaction and told you to `/compact` when you need not
(fixed in 4.7.0).

---

## Shell is not an agent

**Shell** starts your OS default shell (`$SHELL`). Nothing to install, nothing to configure, no
conversation and no GUI tools.

The **launch commands** below the picker are the same idea: they run **the command line you wrote,
verbatim**. MulmoTerminal does not read that command — so a launch command whose text is `claude`
is a terminal with Claude Code in it, **not** an agent session: no session id, no resume, no GUI
tools, no badge. The Agent Picker is what starts an agent.

---

## Running Claude Code differently {#claude-variants}

Two things widen what "Claude" means, and both are Claude-only.

### A different backend or model — `providers`

A `providers` entry in `~/.mulmoterminal/config.json` registers any **Anthropic-compatible**
backend — OpenRouter, Moonshot, a local Ollama bridge, a company gateway — and it then appears in
the Model picker beside Anthropic's own models. A directory can pin its own `provider` / `model` so
a project always runs on the same one.

Full setup, the measured pass rates of the built-in model list, and the misconfigurations that are
hard to diagnose from inside a session: [Providers and models](providers.html).

### Your own command line — `customAgents`

A `customAgents` entry is **your** way of starting Claude Code — a wrapper script, a pinned binary,
`ollama launch claude --model … --` — and it appears in the Agent Picker beside the built-in ones.
Claude Code's whole argv is appended to what you wrote, so the session still resumes, still reports
cost, and still gets the GUI tools.

This is what separates it from a launch command: the entry declares `agent: "claude"`, so
MulmoTerminal knows which CLI's arguments to append. **Only Claude is supported** — an entry for
another agent is not a label that would work.

See [Configuration](config.html#custom-agents) for the entry shape.

---

## Links

- [Basics — how to read the screen](basics.html) — the launcher form, cell by cell
- [Providers and models](providers.html) — backends for Claude sessions
- [Configuration](config.html) — every setting, including `customAgents`
- [Canvas and the GUI panel](features.html) — what the GUI tool groups actually do
