---
title: Basics
layout: default
parent: English
nav_order: 1
---

# Basics — what you can do in the grid
{: .no_toc }

- TOC
{:toc}

---

## Single view and grid view

MulmoTerminal has two display modes. Switch between them with the **chat / grid** icons in the top toolbar.

- **Single view**: a screen for focusing on one session. A chat-style history on the left, and a GUI panel (diagrams, forms, images, documents) on the right.
- **Grid view**: a screen where you tile several terminals and run them **at the same time**. This is the star of this guide.

![Single view](../images/single-view.png)

> Every cell in the grid is an independent PTY. While Claude is thinking in one cell, you can run a shell in another, drive Codex on a different project, or run tests — all at once.

## Launching a terminal (launcher form)

An empty grid cell shows a **launcher form**, where you choose how to start.

![Launcher form in an empty cell](../images/grid-launch-form.png)

| Part | Role |
|---|---|
| **Claude / Codex** toggle | Choose which agent runs in this cell |
| **WORKING DIRECTORY** | Enter the working directory (start it with `▶`). Frequently used directories are autocompleted from the *cwd presets* in your settings |
| **OR ISOLATE IN A WORKTREE** | In a git repo, enter a task name and click **+ New worktree**. This creates an isolated git worktree for the work and launches into it |
| **OR LAUNCH** | A **launch command** other than Claude (e.g. `Shell`, `Node REPL`). The ones you registered in settings appear here |

## Reading a terminal cell

Once launched, the cell becomes a terminal. The header has two rows.

![A launched cell (two-row header)](../images/grid-one-cell.png)

- **Row 1 (info)**: status dot, directory, git chip (`⎇ branch ●change count`), model / context usage, what the session is currently doing, and expand / close.
- **Row 2 (actions)**: connection status (`connected`), attachments, file browser, GitHub, timeline 🕘, and more.

> You can also read the status by **color**. A bluish border means **working** (the agent is thinking), amber means **needs attention** (waiting for input, or there is output you haven't seen), and the default means idle.

## Multiple cells and pages

- Use **New terminal (+)** in the toolbar to add an empty cell. A page holds up to **9 cells**; when it overflows, a new page (tab) is created.
- Enter reorder mode with **Toggle grid cell ordering**, then swap positions using the `◀ ▶` controls on each cell.

![2×2 parallel terminals](../images/grid-2x2.png)

## Zooming into one cell (filmstrip)

Press **⤢** (expand) on a cell to enlarge it; the other cells line up as thumbnails in the **filmstrip** along the bottom.
Click the empty header area of a thumbnail to **switch** to that terminal. Press **⤡** to return to the full grid.

![Zoomed in (filmstrip)](../images/grid-zoom.png)

## Claude and Codex

Within the same grid, you can launch either **Claude** or **Codex** in each cell. Both share the same terminal experience, persistence, and GUI panel mechanics.
Just pick one with the toggle at launch.

---

Next: [Scenarios — usage by user scenario](scenarios.html)
