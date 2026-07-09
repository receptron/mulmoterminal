---
title: English
layout: default
nav_order: 3
has_children: true
---

# MulmoTerminal Guide

## Concept — why this terminal

AI coding agents (**Claude Code** / **Codex**) take minutes to finish a single task. Babysit one and your hands
sit idle the whole time. The bottleneck isn't the CPU or the terminal — it's **your attention**.

That's where MulmoTerminal started. First, as —

> **a command post that runs many agents in parallel, lets you triage by status, and step in only where you're needed.**

From there it grew into something more than a parallel terminal: **a terminal-first, modern development environment**.

### The four pillars

1. **Supervise** — the grid is **a cockpit for your agents**. Send N agents at N tasks / worktrees, and go
   only **to the cell that calls you**, guided by color and notifications — *working (blue) / needs you (amber)*.
2. **See** — the **status, model, context size, git, tool-call timeline, and estimated cost** of every agent, at a glance.
   You always know **what each agent is doing and where**.
3. **Automate & investigate** — run scripts inside a cell, and when one fails, let **AI diagnose** the wall of logs in a few lines (cause, fix).
4. **Extend (DSL)** — extend the header buttons / chips, launchers, and project settings with **a small DSL**.
   Shape the terminal **to fit your own workflow** — which is why it fits any developer.

![A board of AI agent terminals running in parallel](../images/grid-2x2.png)

## How to read this guide

1. [Basics — what you can do in the grid today](basics.html) The grid as a board of agents, triage by status, worktree isolation, launching, and controls.
2. [Scenarios — usage by scenario](scenarios.html) Parallel supervision, visibility, automation, error investigation, and color-coding, shown as real workflows.
3. [Feature reference](features.html) Every feature, organized by the four pillars.
4. [Configuration](config.html) The settings modal, `config.json`, `.mulmoterminal.json`, and **DSL extensions (buttons / chips)**.

> Looking for Japanese? See the [日本語ガイド](../ja/).
