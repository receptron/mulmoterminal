---
title: Feature reference
layout: default
parent: English
nav_order: 3
---

# Feature reference
{: .no_toc }

A summary of the features around the grid view. For how to use them in detail, see [Basics](basics.html) and [Scenarios](scenarios.html).

- TOC
{:toc}

---

## Grid and cells

| Feature | Description |
|---|---|
| Parallel terminals | Up to **9 cells** per page. When it overflows, a new **page (tab)** is added |
| Add / close cells | Add with `New terminal +`, close with the `✕` on each cell |
| Reorder | Swap positions with the `◀ ▶` on each cell in reorder mode |
| Zoom / filmstrip | Enlarge one cell with `⤢` while the rest become thumbnails at the bottom. Click a thumbnail's empty header area to switch |
| Status colors | Working (blue) / needs attention (amber) / idle (default), shown by the border and dot |

## How to launch (launcher form)

| Feature | Description |
|---|---|
| Claude / Codex toggle | Choose the agent per cell |
| Working directory | Launch in any directory, autocompleted from *cwd presets* |
| Worktree isolation | Enter a task name in a git repo to create and launch a worktree |
| Launch commands | Start something other than Claude (`Shell` / `codex` / any command) as a **persistent terminal** |
| Script execution | Run a script from that directory's `script.json` inside the cell |

## Session visibility

| Feature | Description |
|---|---|
| Git status chip | `⎇ branch ●change count ↑ahead ↓behind` always shown in the header |
| Model / context usage | e.g. `Opus · ctx 35%` — the active model and how full the context is |
| Cost (estimated) | Approximate **session / today / this month** cost in settings |
| Activity timeline 🕘 | The agent's tool-call history (newest first) shown in a modal |
| Worktree diff badge | Shows the amount of change on a worktree cell; click for the diff panel |

## Command cells (script execution)

| Feature | Description |
|---|---|
| In-cell execution | Run a command from `script.json` **inside that cell** (temporary; cleared on reload) |
| ✦ Summarize / Explain | Pass terminal output to `claude -p` and summarize errors / warnings / cause / how to fix |
| ⧉ Copy as prompt | Copy command + directory + summary + follow-up and paste it into any session |

## Agents

| Feature | Description |
|---|---|
| Claude Code | The default agent. Hook-driven, showing working / needs-attention in real time |
| Codex | Launch and resume Codex as a first-class agent. The GUI panel is also driven by Codex tool calls |
| Session persistence (tmux) | If tmux is available, each session runs inside tmux and **reconnects** across reloads and server restarts |

## Appearance and header customization

| Feature | Description |
|---|---|
| Name badge / colors | Per-directory name and colors for header / body / border / dot / buttons in `.mulmoterminal.json` |
| Header action buttons | Add `input` (send text) / `open` (URL, Finder, in-app view) / `shell` (run a command) buttons via `buttons` |
| Header display chips | Reorder / hide built-in chips plus custom chips via `chips` |
| Themes | Midnight / Nord / Daylight / Solarized Light |

For details, see [Configuration](config.html).

---

Next: [Configuration](config.html)
