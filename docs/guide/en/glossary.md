---
title: Glossary — parallel agents, worktrees, vibe coding
nav_title: Glossary
layout: default
parent: English
nav_order: 19
description: Vibe coding, parallel agents, AI coding agents, git worktrees, the cockpit roster — the words this guide uses, tied to what you actually see on screen in MulmoTerminal.
---

# Glossary — the words this guide uses
{: .no_toc }

MulmoTerminal is a **browser terminal** for running several **AI coding agents** — **Claude Code**
and **Codex** — side by side. This page lines up the vocabulary with the part of the screen it
refers to.

- TOC
{:toc}

---

## Vibe coding

Building software by describing what you want, taking the code the AI writes, and steering it in
conversation. Andrej Karpathy named it in 2025; by 2026 it is an ordinary way to work (Collins made
it Word of the Year).

MulmoTerminal is where you do that **in a terminal**. Instead of living in an editor, the loop is
**ask, watch, ask again**. One agent needs nothing more than `claude` in a shell — it is when you
start running **several at once** that you lose track of which one is waiting for you. That is the
problem this app exists for.

→ [Basics](basics.html)

## AI coding agent / CLI agent

An AI that runs on the command line, reads your codebase, writes files, runs tests, and opens PRs.
**Claude Code** (Anthropic) and **Codex CLI** (OpenAI) are the two this app launches, per cell — so
you can put the same task to both and compare, or have one review the other.

→ [Mixing agents in one grid](basics.html#claude-and-codex) · [Cross-terminal talk](features.html)

## Parallel agents / multi-agent

Running several agents at the same time. While one thinks you can move another forward — what runs
out is **your attention**, not the machine's. The grid solves that with colour and sound.

- **Awaiting input** is amber; a **finished turn** gets a green ring
- You only pick up the cells that called you
- A sound and a phone push mean you notice without watching the screen

→ [Basics](basics.html) · [Mobile notifications](notifications.html)

## Grid / cell

The **grid** is the screen that holds several agents (and the one the app opens on). A **cell** is
one square: an agent session, a shell, or a single command. Nine cells per page; overflow
opens another page (tab).

→ [Basics](basics.html)

## Agent Picker

The **Claude / Codex / Antigravity / Grok / Muse / Copilot / Cursor / Shell** toggle at the top of an empty cell's launcher form:
what that cell will be started as. It is what starts a real **agent session** — resumable
transcript, cost and context, a "waiting for you" status. Not to be confused with a **launch
command** (a launcher chip), which runs your own command line verbatim, whatever it names.

→ [Basics](basics.html)

## Cockpit roster

The **one-row-per-session list** beside an enlarged cell: directory, AI summary, latest prompt,
latest reply, status word, PR phase. It is how you stay zoomed into one agent while still reading
where all the others stand.

→ [Basics](basics.html) · [Row length](config.html#cockpit-lines)

## GUI panel (Canvas)

The pane beside a **zoomed cell**, where that agent's tool calls render as diagrams, forms, images,
documents, HTML and slides rather than printed text.

Until 3.x it belonged to a separate *single view* at `/chat`. That view was removed in 4.0.0 and the
panel moved to the zoomed cell, which is the same thing — one agent with the window to itself.

## Workspace {#workspace}

The server's **default working directory** (`CLAUDE_CWD`) — settled in the order `--cwd`, the `CLAUDE_CWD` environment variable, then the directory you ran `npx mulmoterminal` in; a server started directly falls back to `~/mulmoclaude`.
It is printed as `Workspace: …` at startup.
Collections, Wiki and Accounting read and write there, and if you also run MulmoClaude it should be **the same directory for both** (`~/mulmoclaude` by default) — not the directory you cloned MulmoClaude into.

It is treated differently from a project directory: **a Claude, Codex or Copilot session launched here has every GUI tool**, the way the single view in 3.x did. Antigravity, Grok, Muse and Cursor are the exceptions — each gets what its directory registered, in the workspace too (→ [Antigravity, Grok, Muse and Cursor register everywhere](basics.html#antigravity-gui-tools)), and a Shell or a **launch command** carries no GUI tools at all, `claude` as the command line included: a launch command is run verbatim and is never an agent session.

→ [Which directory to launch in](basics.html#launch-dir)

## git worktree

A git feature that checks out another branch of the same repository into its own directory, so
**several agents can work one repository without colliding**. That is what makes parallel work
practical. A cell's launcher can create a worktree and start the session inside it.

→ [Isolating work in a git worktree](worktree.html)

## Session persistence (tmux)

Each session runs inside tmux, so **a page reload or a server restart reconnects** instead of losing
it. Without tmux the sessions are plain PTYs and a restart ends them.

## RemoteHost (from your phone)

**Web Push to your phone** when a turn finishes or an agent stops to ask, plus watching, replying,
and starting a terminal from the phone — so walking away doesn't mean missing the call.

→ [Mobile notifications](notifications.html) · [From your phone](phone.html)

## Run cell / scripts

A **throwaway cell** for one command from `script.json` (`yarn dev`, `yarn test`, …). When it fails,
**Summarize output (AI)** turns the log into errors, cause, and how to fix.

→ [Configuration](config.html#put-your-common-commands-in-the-run-menu-scriptjson)

## Provider

An Anthropic-compatible backend Claude Code can talk to. Register OpenRouter and a session can run
**a model other than Claude**.

→ [Using another model via OpenRouter](providers.html)

---

Next: [Configuration](config.html)
