---
title: FAQ — how it compares to VS Code, Cursor, tmux, Claude Squad, Conductor
nav_title: FAQ
layout: default
parent: English
nav_order: 3
description: How it differs from VS Code, Cursor, tmux panes, Claude Squad and Conductor; whether your existing Claude Code sessions (resume) carry over; Windows support; token cost; and what to do when something breaks.
---

# Frequently asked questions
{: .no_toc }

The things people ask before trying it. Anything not here —
[Discussions](https://github.com/receptron/mulmoterminal/discussions) or
[Issues](https://github.com/receptron/mulmoterminal/issues).

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
- TOC
{:toc}
</details>

---

## Switching over

### Do my existing Claude Code sessions carry over?

**Yes.** This is the single most common question.

It is the same `claude --resume`, reading **the same transcripts from your own disk**. Nothing is converted into a private format.

Point it at a directory you already work in and your history is there. **Nothing to migrate, nothing to redo, nothing to re-explain.**

One user, asked what convinced him to switch, answered:

> Just being able to carry over ClaudeCode's resume.

The same person also said he had assumed it *wouldn't* carry over, and would not have tried it at all on that assumption. If that was your reason for not trying it — it carries over.

### Can I go back if I don't like it?

**Yes.** It runs through `npx`; closing it is the whole uninstall.

Sessions live in tmux, and settings live in `~/.mulmoterminal/` plus each project's `.mulmoterminal.json`. **Your existing `~/.claude/` setup is not modified.**

### What happens to my hooks, MCP servers and CLAUDE.md?

**They keep working.** What gets launched is your own `claude` / `codex` CLI — not a wrapper, not a reimplementation.

So your hooks, MCP servers, `CLAUDE.md` and permission settings behave exactly as they did.

---

## How it compares

### How is this different from the VS Code Claude Code extension?

**Different jobs.** It isn't an either/or.

Keeping several agents apart by opening several **VS Code windows** is expensive: each window brings its own editor, language server, extensions and file watchers. An agent costs one process; an IDE costs a whole set.

Here the agents are processes on a server and the UI is **browser tabs**.

People who moved over still say "VS Code sometimes, mainly as a text editor." **A place to supervise agents** and **a place to read and write code** can be two different tools.

### How is this different from Cursor?

**Completion and inline editing are better in Cursor.** This does not try to replace that.

What this does is the step before: **which agent is waiting on you right now**. Put them side by side, colour them by state, and push to your phone when one blocks.

### Why not just split a terminal with tmux?

**tmux was built for terminals that don't ask questions.** `make` finishes quietly, `tail -f`
just runs — neither of them calls you. Agents do: they stop, ask permission, and wait. "Which of
these six is waiting on me" isn't a question tmux was designed to answer, and that isn't a flaw.
The question didn't used to exist.

Splitting itself is easy in tmux. The difference is what comes after.

- **State is visible as colour.** Six panes of scrolling text look identical. Which one has stopped and is waiting, and which one is still thinking, without reading any of it.
- **Watching many and reading one stop competing.** Split six ways and each pane is one sixth the size. Grid ↔ enlarge lets you scan everything, then blow one up and read it properly.
- **Your phone gets called.** You can leave the desk.

**tmux is underneath**, by the way. Close the browser or restart the server and the sessions are still running.

### How is this different from Claude Squad?

**The goal is genuinely close** — tmux plus git worktrees for several agents is the same idea.

The difference is how you see them. Claude Squad is a **TUI** and you look at one at a time. It stays inside the terminal, which makes it **noticeably lighter over SSH** — a real advantage.

This is a browser, showing several live screens at once. That costs you a browser.

### How is this different from Conductor / Crystal?

**Their diff review is more developed**, and being native makes them faster to operate.

One structural difference: they are **desktop apps, so running several means more windows**. The reasons people gave for leaving an IDE were "more windows means running out of memory" and "every window looks the same" — those stay.

This fits in one browser tab, and the same view is reachable from your phone.

---

## Running it

### Does it work on Windows?

**Yes.** Windows, macOS and Linux.

CI runs Linux and macOS on every PR, and Windows nightly. There are Windows-specific test cases as well — path separators, `realpathSync` behaviour, `fs.watch` differences.

### What do I need?

- **Node.js 22.12+**
- `claude` or `codex` on your `PATH`
- optional: `tmux`, for session persistence

```bash
npx mulmoterminal@latest
# → http://localhost:34567
```

No install step.

### Can I run it on a remote box or VPS?

**You can, but it will not accept outside connections by default.**

The server listens on **loopback only** — so a malicious site you happen to open cannot drive your local Claude PTY.

To reach it from elsewhere, **SSH port forwarding** is the recommended route. If you only want your phone, there is a separate path for that (→ [Using it from your phone](phone.html)).

---

## Cost

### Six agents means six times the token bill.

**It does.** Worth saying plainly.

But six agents in parallel describes what you are **already doing**. MulmoTerminal does not consume tokens of its own — it runs your `claude` / `codex`.

What it does add is **making the spend visible**:

- Claude's and Codex's **5-hour / 7-day windows** in the grid header, always
- Model, remaining context and estimated cost per cell

So you stop finding out after you've run out.

### Can I use cheaper or local models?

**Yes.** Register OpenRouter or any Anthropic-compatible gateway, and **pin a model per project**.

For fully local, `claude-ollama` works (→ [Local models with claude-ollama](claude-ollama.html)).

"This repo is fine on a cheap model, that one needs the best" is a per-directory setting.

### Is MulmoTerminal itself free?

**Yes — MIT.** Use it at work, fork it, whatever you need. Nothing is sent to any server we control.

---

## Using it

### How many agents do people actually run?

Asking around, **one to six**, with the heaviest user at eight.

The surprising part: **not one person said they run more agents than before.** What they all said instead was that they can handle **the same number more easily**.

One of them dropped VS Code entirely while running **one to three** sessions. It is not a tool for raising the count — it's a tool for **not losing track**.

### Won't the notifications get exhausting?

**Each kind can be turned off separately.**

"Finished" and "waiting on you" are treated as different events, and each can have its own sound. Silencing the first and keeping the second is a common setup (→ [Notification sounds and phone push](notifications.html)).

### Can several agents work in the same repository?

**They're isolated with git worktrees** — one worktree and one branch per task, so the same repo is safe to parallelise.

Diff, commit, push and Open PR are all reachable from inside the cell (→ [Advanced](scenarios.html)).

### Can I use it as an ordinary terminal?

**Yes.** Pick Shell in an empty cell and choose a directory. No launcher entry, no model, no configuration.

### So it isn't only for agents?

**No — it's a terminal.** Every cell is a real pty, and an agent is one of the things you can put
in one.

- **Shell** gives you your OS default `$SHELL`, with nothing to install or configure.
- **Launch commands** run anything as a persistent terminal — `yarn dev`, `htop`, `lazygit`, a
  `tail -f` you want to keep an eye on.
- The **one-session-per-worktree** limit is on *agents*. A shell or a `yarn dev` launcher stays
  free, because a worktree an agent is working in is exactly where you want those — and each
  variable a project declares in [`worktreeEnv`](config.html#worktree-env) gets a value **per
  worktree**, so two dev servers given a port of their own do not fight over 3000.

So the grid ends up holding your whole working set, not just the agents — and the agents are the
cells that get colour, a chime and a phone push, because they're the ones that stop and ask.

### Which directory should I launch a cell in?

**The repository, when you are working on that project — the workspace, when you want what the single view in 3.x gave you** (the server's default working directory, printed as `Workspace: …` at startup; if you also run MulmoClaude, the workspace you share with it, `~/mulmoclaude` by default).

**A Claude or Codex session launched in the workspace has every GUI tool** — drawing into the Canvas, working with collections, all of it available with nothing to register.
Claude or Codex, it is the same, and the **WORKSPACE** chip at the head of the WORKING DIRECTORY row is the quick way to get there (Antigravity and Grok are the exceptions: wherever either runs, it gets what its directory registered → [Antigravity and Grok register everywhere](basics.html#antigravity-gui-tools)). A **launch command** is not this — it runs your command line verbatim and carries no GUI tools, `claude` included.
A cell in a project directory has only the tool groups registered for that directory, so register one with the launcher's MCP toggles when you want GUI tools there (→ [which directory to launch in](basics.html#launch-dir)).

---

## Other

### What does "Mulmo" mean?

**Short for multimodal.**

Though compared to siblings like [MulmoCast](https://mulmocast.com), MulmoTerminal is easily **the least multimodal of the family**. The name is a family matter.

### Who builds this, and will it still be here next year?

**[receptron](https://github.com/receptron) — [Satoshi Nakajima](https://x.com/snakajima) and [Isamu Arimoto](https://github.com/isamu).** The two have shipped open source together since 2015: a [GPU video engine](https://github.com/snakajima/videoshader) for iOS, an [animation runtime](https://github.com/swipe-org/swipe) that made manga move on phones, [takeout ordering](https://github.com/Nakajima-Foundation/ownplate) built for restaurants during COVID, then [SlashGPT](https://github.com/receptron/SlashGPT), [GraphAI](https://github.com/receptron/graphai) and [MulmoCast](https://github.com/receptron/mulmocast-cli).

Nobody can promise you a next year. What you can check is the record: these two were shipping open source together eight years before the current wave of AI tooling, and every one of those repositories is still up. It is MIT either way — **if we stop, you can carry on.**

### Something is broken. What now?

Type **`/mulmoterminal-bug-report`** in a session. The bundled skill hears the symptom, reads your **actual** config and version to check whether it is configuration or by design, searches existing issues, and only writes up what survives all of that (environment collected automatically, secrets masked).

For configuration questions, **`/mulmoterminal-config`** walks you through it.

### Something is inconvenient. Where do I say so?

**Please tell us.** Several things on this page exist because someone said "this bit is annoying."

- [GitHub Discussions](https://github.com/receptron/mulmoterminal/discussions)
- [Issues](https://github.com/receptron/mulmoterminal/issues)
