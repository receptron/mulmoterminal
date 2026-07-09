---
title: Basics
layout: default
parent: English
nav_order: 1
---

# Basics — what you can do in the grid today
{: .no_toc }

- TOC
{:toc}

---

## The grid is "a board of agents"

The grid view is the screen for **supervising many AI agents in parallel**. Each cell is one independent
agent (or terminal). While one is thinking, you push another cell forward and pick up **only the ones that
turn amber (needs you)** — the goal is to run many agents solo instead of babysitting them all.

MulmoTerminal has two display modes; switch between them with the **chat / grid** icons in the top toolbar.

- **Single view** — the screen for **focusing** on one agent (conversation on the left, a GUI panel on the right for diagrams, forms, images, and documents).
- **Grid view** — the screen for **supervising many agents at once**, tiled side by side. This is the star of this guide.

![Single view — focus on one agent](../images/single-view.png)

## Launching an agent (launcher form)

Empty cells in the grid show a **launcher form**. This is where you choose **what** to run and **where**.

![The launcher form in an empty cell](../images/grid-launch-form.png)

| Part | Role |
|---|---|
| **Claude / Codex** toggle | Choose the **agent** to run in this cell |
| **WORKING DIRECTORY** | Enter the working directory (`▶` to launch). Frequently used directories autocomplete from *cwd presets* |
| **OR ISOLATE IN A WORKTREE** | In a git repo, enter a task name and hit **＋ New worktree** to create an isolated worktree and launch there |
| **OR LAUNCH** | Start a non-agent **launch command** (`Shell` / `codex` / anything) as a persistent terminal |

## Reading a cell — "what each agent is doing and where"

The header of a running cell has two rows. Together they capture that agent's **status, location, and current work**.

![A running cell (two-row header)](../images/grid-one-cell.png)

- **Row 1 (info):** status dot, directory, git chip (`⎇ branch ●changes`), **model / context size**,
  what that agent is **doing right now**, and expand / close.
- **Row 2 (controls):** connection status, attachments, file browser, GitHub, and the **timeline 🕘** (tool-call history).

> **Status shows up as color.** A bluish border means **working** (thinking), amber means **needs you** (awaiting input,
> or unread output), and neutral means idle. A sound plays too, so you know you've been **called without watching the screen**.
> This is the heart of the grid.

## Tiling many, pages, and reordering

- Add cells with **New terminal (＋)** in the toolbar. Up to **9 cells** per page; overflow moves to the next page (tab).
- Enter reorder mode with **Toggle grid cell ordering**, then swap positions with each cell's `◀ ▶`.

![Agents running in parallel](../images/grid-2x2.png)

## Zooming into one (filmstrip)

Hit a cell's **⤢** (expand) to show that agent large while the others shrink into thumbnails in the **filmstrip**
along the bottom. Click a thumbnail's header margin to **switch**, and **⤡** returns to the grid. You can jump quickly
between surveying the whole board and zooming into one.

![Zoom (filmstrip)](../images/grid-zoom.png)

## Mixing Claude and Codex

In the same grid, you can launch **Claude** or **Codex** per cell. Both share the same terminal experience,
persistence, GUI panel, and visibility machinery. Use each for its strengths, or throw the same task at both and compare.

---

Next: [Scenarios — usage by scenario](scenarios.html)
