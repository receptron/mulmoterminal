---
title: English
layout: default
nav_order: 3
has_children: true
---

# MulmoTerminal Guide (English)

MulmoTerminal is a workspace that runs **Claude Code** and **Codex** as *real terminals* in your browser.
Each session runs in a PTY (pseudo-terminal) on the server and is streamed to an [xterm.js](https://xtermjs.org/) screen over WebSocket.

This guide focuses on the **grid view** — the screen where you tile several terminals side by side and run them all at once — and covers what you can do today, how to use it in practice, the full feature list, and how to configure it.

![Four terminals running in parallel in the grid](../images/grid-2x2.png)

## Contents

1. [Basics — what you can do in the grid](basics.html)
   What the grid is, launching terminals, working with cells, pages, and switching between Claude and Codex.
2. [Scenarios — usage by user scenario](scenarios.html)
   Working in parallel, isolating work in a worktree, spanning multiple repos, running scripts with AI summaries, color-coding, and more.
3. [Feature reference](features.html)
   A consolidated list of the features around the grid.
4. [Configuration](config.html)
   The settings modal, `config.json`, `.mulmoterminal.json`, `script.json`, and environment variables.

> Looking for Japanese? See the [日本語ガイド](../ja/).
