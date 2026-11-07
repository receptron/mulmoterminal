---
title: Open-source alternatives for running parallel AI coding agents
nav_title: Alternatives
layout: default
parent: English
nav_order: 18
description: An honest map of the tools that run several Claude Code / Codex sessions at once — T3 Code, Vibe Kanban, Nimbalyst, Parallel Code, Conductor, Claude Squad, Codealong, and Claude Code's own `claude agents` — and which one fits which bottleneck. Written by the maintainer of one of them.
---

# Open-source alternatives for running parallel AI coding agents
{: .no_toc }

**Disclosure: I maintain MulmoTerminal, one of the tools on this page.** So read this as a map
drawn by someone standing inside it, not a review. What I can offer instead of neutrality is
being specific about where the others are better, and about what I have not tested.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
- TOC
{:toc}
</details>

---

## Before any of this: try what you already have

`claude agents` has been in Claude Code since **2.1.139** as a Research Preview, and I keep
meeting people who don't know it exists.

```bash
claude agents
```

It lists your **background** sessions grouped by Working / Needs input / Completed, with a
one-line summary each. Interactive sessions appear once you background them.

There's also `claude --worktree <name>` (since **2.1.49**), which cuts an isolated worktree and
starts a session in it, cleanup included.

**If that's enough, you're done.** It costs nothing, there's nothing to install, and it's
maintained by the people who make the agent. Everything below is for what happens when it isn't
enough.

---

## The three bottlenecks

Every tool here solves parallel agents. They differ in *which part of it hurts you*.

| If your problem is… | …the shape you want |
|---|---|
| **Reading** — one agent produced 4,000 characters and you can't read it in a sixth of a screen | Several live terminals visible at once |
| **Reviewing** — five branches landed and you have to judge them | Diff-first, worktree-per-task |
| **Coordinating** — you lose track of what each task even was | A board or task graph |
| **Isolating** — you don't want a permission-skipped agent on your real machine | Containers, not just worktrees |
| **Reaching** — the work is on a machine you are not sitting at | A relay and a phone client, not just a port |

Pick by that, not by feature count.

---

## The tools

Figures checked 2026-08-03, except T3 Code and Vibe Kanban, re-checked 2026-11-08. This space
changes fast — Crystal became Nimbalyst, Terragon shut down, and Vibe Kanban's company (Bloop)
wound down in April 2026 while the project continues as community-maintained OSS.

### T3 Code

**~50,000 stars · MIT · desktop, native mobile and a hosted web client · macOS / Windows / Linux**

The largest project on this page by a wide margin, and the youngest of the large ones — the
repository was created in February 2026 and nightly builds go out every few hours. An Electron
desktop app, **native iOS and Android apps**, and a hosted web client at `app.t3.codes` that
reaches your machine through a relay the project runs, so getting to your agents from a phone
needs no networking of your own. Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity
and fx.

The shape is a **sidebar of threads with one open at a time**, and the terminal is a panel beside
it rather than the main view. A guest link (beta) lets someone follow one thread in a browser and
ask questions without an account. Three machines on the free plan; more needs a paid T3 Chat plan.

**Where it differs from this one is underneath, and their own FAQ puts it better than I could:**
"Claude Code is kind of a harness. It is an interface (the TUI, the Code tab in the desktop app)
plus a harness underneath (the Anthropic Agent SDK) … T3 Code uses those harnesses. It is not a
harness, and it does not work without one." MulmoTerminal keeps the interface instead: it runs
the `claude` CLI itself inside a real pty. One consequence of the other route is written up in
that same FAQ — "all Agent SDK usage will drain your 5h limits faster than using Claude Code
directly" — which they report as an upstream bug rather than as a design choice. Weekly limits
are unaffected.

**If you want native mobile apps, a relay you don't have to run yourself, or OpenCode, this is
the better pick.**

### Vibe Kanban

**~28,600 stars · Apache-2.0 · board-first**

The largest of the board-first ones. Models the work as **tasks on a kanban board** rather than as
sessions, which is the right abstraction if what you lose track of is *what you asked for*.
Usable from a mobile browser.

Now community-maintained after its company wound down — worth knowing if you care about who is
answering issues in six months.

### Nimbalyst

**~1,379 stars · MIT · visual workspace · macOS / Windows / Linux**

Formerly Crystal. A desktop app built around **editing what the agents produce** — markdown,
mockups, diagrams — with task tracking around it, plus git management and worktrees.

**Native iOS and Android apps.** If you want a real phone app rather than a web page, this is
the one. Supports Claude Code, Codex and OpenCode.

### Parallel Code

**~716 stars · MIT · desktop · macOS / Linux**

Built solo by the maintainer of Super Productivity. Each agent gets its own worktree and branch;
the design centres on **reviewing the diffs and merging the wins**. Supports Claude Code, Codex
and **Gemini**.

If your bottleneck is judging output rather than watching it happen, this shape fits better than
mine.

### Conductor

**macOS only · proprietary**

Worktree isolation plus a well-built diff review step. Not an option on Windows or Linux.

### Claude Squad

**TUI · tmux + worktrees**

Manages agents as tmux sessions from inside the terminal. **Lighter than anything with a GUI**,
and the right answer if you don't want to leave the terminal or you're working over SSH. You see
one session at a time.

### Codealong

**Apache-2.0 · desktop · macOS / Linux (X11)**

A different layer rather than a different shape. It reads the records each agent already writes,
so the board shows sessions it never started — in a terminal, in tmux, in the Claude app or the
Codex app, on a second account, on another machine you have linked — organised as project, repo,
worktree, branch and pull request. You can allow a command or answer a question from its windows
instead of going to find the session. Claude Code, Codex, OpenCode, Antigravity and Cursor.

It starts work as well, in your terminal or the agent's own app, and in its own panel over the
Agent Client Protocol if you ask for that. What it does not do is isolate: the worktrees are the
agent's, and it otherwise reads git rather than writing it. So it sits **beside** whichever tool
above you pick rather than instead of one. Its first release came out on 2026-10-20, so it is very
new; this entry was checked on 2026-10-21 rather than 2026-08-03 like the rest of the page.

### MulmoTerminal

**MIT · browser · macOS / Linux / Windows**

Mine. A browser board of **several live terminals at once**, colour-coded by state, with a chime
and a web push when one is waiting on you. Sessions run in tmux, so closing the tab or restarting
the server doesn't end them. Claude Code, Codex, Antigravity, Grok, Muse, GitHub Copilot CLI and Cursor CLI.

The bet is that a one-line summary is good for triage and no help when you actually want to read
a long reply while five others keep running.

**What it doesn't do:** no container isolation (the Docker sandbox was removed in 4.0.0 —
worktrees are the whole story), no native mobile app, and no Gemini or OpenCode.

Machine-readable facts: [`facts.json`](https://receptron.github.io/mulmoterminal/facts.json).

---

## Side by side

| | Interface | Licence | Agents | Mobile | Isolation |
|---|---|---|---|---|---|
| **T3 Code** | Desktop + web | MIT | Claude, Codex, Cursor, Grok Build, OpenCode, Antigravity, fx | **Native iOS + Android**, hosted relay | Worktrees |
| **Vibe Kanban** | Web | Apache-2.0 | Many | Browser | Worktrees |
| **Nimbalyst** | Desktop | MIT | Claude, Codex, OpenCode | **Native iOS + Android** | Worktrees |
| **Parallel Code** | Desktop | MIT | Claude, Codex, **Gemini** | — | Worktrees |
| **Conductor** | Desktop (macOS) | Proprietary | Claude, Codex, Cursor | — | Worktrees |
| **Claude Squad** | TUI | OSS | Claude, Codex, OpenCode, Amp | — | Worktrees |
| **`claude agents`** | TUI | First-party | Claude | — | Worktrees |
| **Codealong** | Desktop | Apache-2.0 | Claude, Codex, OpenCode, Antigravity, Cursor | iPhone app, early | **None of its own** |
| **MulmoTerminal** | **Browser** | MIT | Claude, Codex, Antigravity, Grok, Muse, Copilot, Cursor | Web + push | Worktrees |

**Notice what's the same.** Nearly everything here is open source, worktree-based, and local. If
someone tells you their differentiator is "MIT" or "runs locally," that's the floor, not a
feature.

**And what nobody in this list does:** container-per-agent isolation. If running an agent with
permissions skipped on your real machine is what keeps you up, none of these solve it — you want
a devcontainer or a VM underneath whichever one you pick.

---

## How I'd choose

- **You want to leave the terminal as little as possible** → Claude Squad, or `claude agents`.
- **You want a real phone app** → T3 Code or Nimbalyst.
- **You are rarely at the machine the work runs on** → T3 Code, whose relay saves you from
  exposing or tunnelling anything.
- **You mostly need to judge diffs afterwards** → Parallel Code, or Conductor on a Mac.
- **You lose track of the tasks themselves** → Vibe Kanban.
- **Your sessions are scattered across tools, accounts or machines and you want to find them**
  → Codealong, beside any of the above.
- **You want to watch several running at once, from any device on your network** → this one.

Most of them install in a minute. Trying two is cheaper than reading about six.

---

## What I haven't tested

I use MulmoTerminal daily. The others I have read the source and documentation of, and have not
run for a sustained period. Where I've stated a capability above it comes from the project's own
README or docs, not from my own use — so if I've mischaracterised yours,
[tell me](https://github.com/receptron/mulmoterminal/issues) and I'll fix it. Codealong is on
this page because its maker did exactly that.

---

← [English guide index](index.html)
