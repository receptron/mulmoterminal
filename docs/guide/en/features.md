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
| Parallel terminals | Up to **9 cells** per page; overflow adds a new **page (tab)**. Cells auto-sort by state (needs-you first) |
| Status colors + sound | Working (blue) / **awaiting input (amber)** / **done, review it (blue ring)** / idle. Know you've been "called" without watching |
| Cockpit roster | While zoomed with `⤢`, a **one-row-per-session text list** beside the terminal (directory, AI summary, prompt, latest reply, status word). Click a row to swap; `▤ / ☰` toggles the thumbnail filmstrip |
| Add / close / reorder cells | `New terminal ＋`, each cell's `✕`, and `◀ ▶` in reorder mode |
| Worktree isolation | Git worktrees so many agents can run on the same repo without colliding |
| Session persistence (tmux) | If tmux is available, each session runs inside tmux and **reconnects** across reloads and server restarts |
| Phone companion (RemoteHost) | **Web Push to your phone** on finished / input-waiting turns, plus **watch & quick-reply from the phone** (→ [Mobile notifications](notifications.html)) |

## 2. See — what each agent is doing and where

| Feature | Description |
|---|---|
| That agent's current work | The header shows "what it's doing right now" |
| Git status chip | `⎇ branch ●changes ↑ahead ↓behind`, always shown |
| PR phase / work phase | Each roster row badges the branch's **PR state** (draft / CI fail / changes / ready / merged …) and the work phase (planning / editing) |
| Model / context size | e.g. `Opus · ctx 35%` — the active model and how full the context is |
| Activity timeline 🕘 | Tool-call history (Bash / Read / Edit …) shown newest-first in a modal |
| Cost (estimated) | Approximate **session / today / this month** cost in settings |
| Worktree diff badge | Shows the amount of change on a worktree cell; click for the diff panel |
| GUI panel | Renders diagrams, forms, images, and documents — plus HTML, **video/slides (MulmoCast)**, collections, and accounting — from the agent's tool calls (Claude / Codex both supported) |
| Cross-repo PRs / Issues view | All registered repos' **open PRs and issues** in one Pull requests view in the toolbar |
| Wiki / Collections / Accounting / Files | In-app views from the toolbar: a Wiki (with a graph view), collections, accounting, and a **file explorer + editor** |
| Update notice | When a new version ships, the header shows an **update badge**; click it for the update command that fits your install (npm / git clone) |

## 3. Automate & investigate

| Feature | Description |
|---|---|
| Script execution | Run a command from that directory's `script.json`. From a running session's ▶ Run menu it launches in **a spare cell next door**, so the conversation isn't interrupted (an empty cell's launcher runs it in place) |
| ⚡ Skill menu | Lists the skills available in that directory (`.claude/skills`); picking one runs its `/<slug>` **in the current session**. Working-dir skills show first; narrow the list with `skills` in `.mulmoterminal.json` |
| ✦ Summarize / Explain | Pass terminal output to `claude -p` and summarize **errors / warnings / cause / how to fix** |
| ⧉ Copy as prompt | Copy command + directory + summary + follow-up and paste it into any session |
| 💬 / ⇄ Cross-terminal talk | 💬 brings another cell's last turn into this one; **⇄ Exchange** does an **automatic round-trip** — send, wait for the other agent's answer, bring it back (great for Claude ↔ Codex mutual review) |
| Git actions | One click from a worktree cell: **commit (ask Claude) / push / ⧉ Open PR** |
| File attach | **Drag & drop** a file onto the terminal, or use 📎 to pick one in the OS dialog — the **absolute path is inserted** |
| Voice input | Dictate into the prompt via microphone transcription |
| MCP servers | Join your own HTTP MCP servers to sessions via the MCP SERVERS setting |
| Launch commands | Start something other than Claude (`Shell` / `codex` / anything) as a **persistent terminal** |

## 4. Extend — a DSL to fit you

| Feature | Description |
|---|---|
| Header action buttons | Add `input` (send text) / `open` (URL, file manager, in-app views, file picker, new terminal, PR) / `shell` (run a command) via `buttons`, with `${variables}` and `when` conditions |
| Header display chips | Reorder / hide built-in chips plus custom chips via `chips` |
| Name badge / colors | Per-directory name and per-element colors in `.mulmoterminal.json` |
| Launchers / cwd presets / PR repos | Extend launch commands, working-directory suggestions, and cross-repo PR targets in settings |
| Themes | Midnight / Nord / Daylight / Solarized Light |

> **Do nothing and it works as before** — buttons/chips/colors only take effect for what you add, and the default look is unchanged.
> For details, see [Configuration](config.html).

---

Next: [Configuration](config.html)
