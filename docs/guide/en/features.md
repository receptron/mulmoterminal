---
title: Feature reference
layout: default
parent: English
nav_order: 3
---

# Feature reference
{: .no_toc }

MulmoTerminal's features, organized by the **four pillars** (Supervise / See / Automate & investigate / Extend). For how to use them, see [Basics](basics.html) and [Scenarios](scenarios.html).

- TOC
{:toc}

---

## 1. Supervise — a cockpit for parallel agents

| Feature | Description |
|---|---|
| Parallel terminals | Up to **9 cells** per page; overflow adds a new **page (tab)** |
| Status colors + sound | Working (blue) / needs you (amber) / idle. Know you've been "called" without watching |
| Add / close / reorder cells | `New terminal ＋`, each cell's `✕`, and `◀ ▶` in reorder mode |
| Zoom / filmstrip | `⤢` zooms into one agent while the rest become thumbnails. Jump quickly between the whole board and one agent |
| Worktree isolation | Git worktrees so many agents can run on the same repo without colliding |
| Session persistence (tmux) | If tmux is available, each session runs inside tmux and **reconnects** across reloads and server restarts |

## 2. See — what each agent is doing and where

| Feature | Description |
|---|---|
| That agent's current work | The header shows "what it's doing right now" |
| Git status chip | `⎇ branch ●changes ↑ahead ↓behind`, always shown |
| Model / context size | e.g. `Opus · ctx 35%` — the active model and how full the context is |
| Activity timeline 🕘 | Tool-call history (Bash / Read / Edit …) shown newest-first in a modal |
| Cost (estimated) | Approximate **session / today / this month** cost in settings |
| Worktree diff badge | Shows the amount of change on a worktree cell; click for the diff panel |
| GUI panel | Renders diagrams, forms, images, and documents from the agent's tool calls (Claude / Codex both supported) |

## 3. Automate & investigate

| Feature | Description |
|---|---|
| Script execution | Run a command from that directory's `script.json` **inside the cell** |
| ⚡ Skill menu | Lists the skills available in that directory (`.claude/skills`); picking one runs its `/<slug>` **in the current session**. Working-dir skills show first; narrow the list with `skills` in `.mulmoterminal.json` |
| ✦ Summarize / Explain | Pass terminal output to `claude -p` and summarize **errors / warnings / cause / how to fix** |
| ⧉ Copy as prompt | Copy command + directory + summary + follow-up and paste it into any session |
| Launch commands | Start something other than Claude (`Shell` / `codex` / anything) as a **persistent terminal** |

## 4. Extend — a DSL to fit you

| Feature | Description |
|---|---|
| Header action buttons | Add `input` (send text) / `open` (URL, file manager, in-app view) / `shell` (run a command) via `buttons`, with `${variables}` and `when` conditions |
| Header display chips | Reorder / hide built-in chips plus custom chips via `chips` |
| Name badge / colors | Per-directory name and per-element colors in `.mulmoterminal.json` |
| Launchers / cwd presets / PR repos | Extend launch commands, working-directory suggestions, and cross-repo PR targets in settings |
| Themes | Midnight / Nord / Daylight / Solarized Light |

> **Do nothing and it works as before** — buttons/chips/colors only take effect for what you add, and the default look is unchanged.
> For details, see [Configuration](config.html).

---

Next: [Configuration](config.html)
