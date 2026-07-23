---
title: English
layout: default
nav_order: 3
has_children: true
---

# MulmoTerminal Guide (English)

## Vibe-coding with AI agents — sound familiar?

As you run more and more terminals and AI agents (**Claude Code** / **Codex**)…

- 📊 you **lose track of which one is doing what** (their status)
- 📁 you can't tell **which directory** each is in
- 💭 even when you know the dir, **what did I even ask it?** (you forget the instruction)
- 🔔 an agent **finishes and you don't notice** — it waits on you, or you wait on it
- 💥 close the tab or the terminal drops, and **the session is gone**
- 🌿 you want to check git or open a folder, but keep **typing commands for it**
- ⚡ all you really wanted was to **work fast with the terminal as your hub** —

AI agents take minutes per task. Babysit one and your hands sit idle; add more and keeping track gets harder.
The bottleneck isn't the CPU or the terminal — it's **your attention**.

## Every one of these, handled

| The moment | In MulmoTerminal |
|---|---|
| Can't tell the **status** of many terminals | Lay them out in a grid; **status colors** (working = blue / needs-attention = amber) + a sound, at a glance (→ [Basics](basics.html)) |
| Don't know **which directory** | Each cell shows its dir, a **project name badge, and colors**. Color-code to tell them apart (→ [Config](config.html#per-dir)) |
| **Forget the instruction** | The cell header always shows the **latest instruction / what it's doing**; 🕘 shows the **tool-call history** (→ [Feature reference](features.html)) |
| Want to **know it's done** | A finished / input-waiting cell turns **amber + plays a sound** — you know you're "called" |
| Want the **session to survive** | **tmux persistence** keeps it alive across reload, reconnect, and server restart |
| Open **git / a dir** quickly | A git status chip; open **the OS file manager (Finder/Explorer) / the in-app files / a PR** in one click |
| Work with the **terminal as the hub** | All of the above on top of a terminal, and **extend it to your workflow with a DSL** (→ [Config](config.html#header)) |

## The four pillars behind it

1. **Supervise** — the grid is a **cockpit for parallel agents**. Triage by status color + sound; step in only where you're needed.
2. **See** — each agent's **status, model, context, git, tool-call timeline, and cost**, at a glance. What each one is doing and where, always visible.
3. **Automate & investigate** — run scripts in a cell; when one fails, **turn a wall of logs into a short AI diagnosis**.
4. **Extend (DSL)** — header buttons/chips, launchers, and per-project config via **a small DSL** — it fits any developer.

![A board of parallel AI-agent terminals](../images/grid-2x2.png)

## 🚀 Get started

If the [`claude`](https://claude.com/claude-code) CLI (Claude Code) runs on your machine and you have **Node ≥ 22.9**,
one command starts it (`tmux` is ideal for persistent sessions):

```bash
npx mulmoterminal@latest    # opens http://localhost:34567
```

## How to read this guide

1. [Basics — what you can do in the grid](basics.html)
2. [Scenarios — workflows by example](scenarios.html)
3. [Feature reference](features.html) (grouped by the four pillars)
4. [Configuration](config.html) (settings modal · `config.json` · `.mulmoterminal.json` · the **DSL**)
5. [Using another model via OpenRouter](providers.html) (run Kimi / DeepSeek / Gemini, with measured data)
6. [Local models with claude-ollama](claude-ollama.html) (fully local, offline, via Ollama)

> The Japanese guide is here: [日本語ガイド](../ja/).
