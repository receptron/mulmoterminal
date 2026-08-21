---
title: English
layout: default
nav_order: 3
has_children: true
description: A browser-terminal cockpit for running several AI coding agents (Claude Code, Codex) in parallel — the grid, the cockpit roster, git worktrees and phone push. Vibe coding, parallelised.
---

# MulmoTerminal Guide (English)

> **4.10.1 is out.** A zoomed cell no longer grows a scrollbar that scrolls nothing, and the
> Prompts pane can be selected and copied with the mouse. Nothing to configure —
> [what changed and how to tell](v4.10.1.html).


<video controls playsinline preload="metadata" style="width: 100%; max-width: 900px; border-radius: 6px;">
  <source src="../videos/launch-demo-en.mp4" type="video/mp4">
  <track kind="captions" src="../videos/launch-demo-en.vtt" srclang="en" label="English">
  <a href="../videos/launch-demo-en.mp4">Watch the demo (MP4, 3.3 MB)</a> — this browser can't play it inline.
</video>

<details markdown="block">
<summary>Transcript of the narration</summary>

When you ran one coding agent, the slowest thing in the room was the agent.

Now that you run five, the slowest thing in the room is probably you.

One of them is always stopped. A permission prompt. A question. Until you notice, it does nothing at all.

MulmoTerminal puts every session on one screen. Blue is working. Green is done. Amber is waiting on you.

You stop hunting. You go where the light is.

The other kind of slow is: what did I even ask this one? The roster keeps one line per session — what you asked, and what came back. Nothing left to remember.

When one is done, you don't go looking for its window. Click its row — the next order goes in right there.

Then you pick the next one from whatever is lit. Click, answer, move on. You never go looking — the roster tells you.

We built MulmoTerminal for exactly that: not to watch agents, but to triage them.

That is the whole install.

</details>

*90 seconds, with sound — one agent, then a grid of them, each cell coloured **working**, **done** or **needs you**. Zoom into one and the roster still holds what every other session asked, answered and did, so you go to whichever is lit and lose nothing catching up.*


**New here?** Opening a terminal, installing Node.js / Claude Code / git / gh on macOS and
Windows, the start command, and what to do when it doesn't work — **installing and launching
is one page**, written so someone who doesn't write code for a living still ends up with a
running grid. Already set up? `npx mulmoterminal@latest` is the whole thing.

[Getting started — from zero to running](getting-started.html){: .btn .btn-purple .fs-5 .mb-4 .mb-md-0 .mr-2 }
[Basics — how to read the screen](basics.html){: .btn .fs-5 .mb-4 .mb-md-0 }

> **[What's new in 4.8.4](v4.8.4.html)** — **fixes only; nothing to configure**. A push notification whose body was **the prompt you had just typed** is fixed — the reply now comes from the value the hook that reports the turn already carries, instead of being re-read from the transcript. In a session you had **`/clear`ed, every later finished push** was that way. Also fixed: terminal Japanese arriving as **runs of `_`** (not the font — tmux was substituting because it found no UTF-8 locale name), a shared app's publish handing out **a URL that does not open**, and the public view's **link refusal doing nothing on Windows** (as of 2026-08-15)
>
> **[What's new in 4.8.3](v4.8.3.html)** — **Answering a question, at the desk and on the phone**. A Claude session stopped on a question can be answered from **buttons beside the terminal** (turn on **Settings → Terminal keys → Question pane**), **in your own words** when it asks one thing and takes one answer, and **from your phone** with nothing to turn on — a card under the screen, because a phone has no arrow keys to answer with. The dialog in the terminal never goes away: a button press drives it, and whichever end answers first wins. The phone sends option numbers, never keys or bytes. Also: someone who booked a slot in a shared app can **take their own booking back** (as of 2026-08-14)
>
> **[What's new in 4.8.1](v4.8.1.html)** — **a server that stops running out of terminals**. After a few days of uptime every new session failed with `forkpty: Device not configured`, because each spawn leaked two file descriptors on macOS — one of them a whole pseudo-terminal — until the machine hit its limit of 511. **Nothing to configure; restart onto this version.** Also: a project folder's collection now **refreshes on schedule** instead of writing into the workspace's same-named collection, and a **card stays with the project it was made in** rather than showing another project's rows after the app moves (as of 2026-08-10)
>
> **[What's new in 4.8.0](v4.8.0.html)** — **collections in the cell, and tasks that catch up**. A **Collections pane** sits in each cell's right pane beside Canvas / Tools / Files and lists the collections of **that cell's directory** — no project picker, because a cell already names a folder. **Keep your collections in the workspace for now**: the per-folder feature is not finished (no scheduled refresh there, no phone access, and cards from two projects cannot share a panel), and the release page says exactly what is missing. Separately, a scheduled task no longer loses a run because the server was off at its UTC window: every run is recorded and **the missed one is made up at startup** — which is why a dev worklog you enabled may never have produced a page (as of 2026-08-10)
>
> **[What's new in 4.7.5](v4.7.5.html)** — **Settings you can find, in a language you read**: the modal is a **sidebar of nine grouped sections** instead of one 24-heading scroll, and from the keyboard the whole sidebar is one Tab stop with arrows moving inside it. The whole modal is now available in **English and 日本語** — it follows your browser's language, and **Language** is the first entry in the sidebar so it is findable by someone who cannot read the rest of the screen. And a **skill button asks before it starts an agent session**, naming the agent and saying how to stop it; Cancel leaves Settings exactly where it was (as of 2026-08-09)
>
> **[What's new in 4.7.4](v4.7.4.html)** — **your project's icon now reaches your phone**: the picture that tells cells apart in the grid — `icon` in a project's `.mulmoterminal.json`, or the favicon its repository already ships — now appears in the phone app's **terminal list** and **terminal screen**, taking the place of the terminal glyph. That glyph's green/grey said whether a session is live, so the colour moved to a dot on the icon's corner. A **`claude` or `codex` launch from the phone finally starts** instead of stopping at the empty cell-creation form waiting for someone at the desktop. And **codex session discovery** stopped re-reading 149 files and 37 MB every second to look at a few hundred bytes (as of 2026-08-08)
>
> **[What's new in 4.7.3](v4.7.3.html)** — **`+ New worktree` made one worktree per click**: it looked identical to the moment before you pressed it for the six seconds `git worktree add` takes on a big repository, so it got pressed again — and each press succeeded. Every control in that section now holds itself and shows a spinner, and **a refused create finally says why** instead of nothing at all. A cell whose **worktree is being removed** greys out behind a spinner and cannot be clicked or tabbed into. And **pressing Enter takes a scrolled-up terminal back to the latest output**, the way an ordinary terminal does — on by default, with a checkbox in Settings (as of 2026-08-08)
>
> **[What's new in 4.7.2](v4.7.2.html)** — **a terminal that came back on the WRONG backend process is fixed**: a conversation still running in tmux read as free, so resuming it started a second backend on it. Fixed across three layers, together with codex activity that never restarted after a server restart. **Worktrees no longer pile up as working-directory chips** (already-saved ones stay — remove them with the chip's ×), the **cockpit roster** wears the Agent Picker's marks and one border geometry, **collection chats can choose their agent** again, and the folder button opens **one** file dialog however many times you click (as of 2026-08-08)
>
> **[What's new in 4.7.0](v4.7.0.html)** — **Muse** joins the Agent Picker as a fifth agent, running **Muse Spark** — and its cells now reach the **GUI tools**, through a per-machine plugin no other agent uses (set `MUSE_EXPERIMENTAL_PLUGINS=1`). A new **[Which coding agent](agents.html)** page covers all five: what each needs installed, how each resumes, and the three different routes to the GUI tools. On **Windows**, every Claude session on a `.cmd` install can start again — the closing-summary workaround is no longer needed (as of 2026-08-07)
>
> **[What's new in 4.6.1](v4.6.1.html)** — a round table's conversation is now kept in a **room**: an append-only log you can open from **Rooms** in the toolbar, post into yourself, and reach from a shell with `mulmoterminal room`. A speaker reads **the whole conversation so far**, not just the last reply. Sessions that **survived a restart** are listed in Settings with a Stop button, and idle ones are ended at the next start. And a cell no longer **slows down the command it is showing** — six cells running the same heavy command went from 8.2 s to 2.2 s (as of 2026-08-06)
>
> **[What's new in 4.6.0](v4.6.0.html)** — **Round table** runs a conversation around a ring of up to five cells for a turn budget you set: tick the seats in a cell's forum menu and press start. The launcher's **resume list is the agent you picked**, so a codex, agy or grok conversation is finally reachable. A session left **running with nobody attached** says so and can be stopped there. And **every agent's cell** shows its model and how full its context is. Nothing to configure — but read what a table costs before you start one (as of 2026-08-06)
>
> **[What's new in 4.5.1](v4.5.1.html)** — a backend registered under an id other than `openrouter` **stops appearing as a row you cannot click**: the MODEL list offers only what it can actually run, and the link beside it reads **Needs attention** with the sentence naming what is missing. **Choose a folder…** now works on a Linux desktop and under **WSL2 without zenity**, and says so when the host has no dialog at all. One line to add, and only if you registered such a backend (as of 2026-08-05)
>
> **[What's new in 4.5.0](v4.5.0.html)** — a repository can now **carry its own icon and colour**, in [`repo.json`](../../repo-json.html): an open metadata file any tool can read, so a project states its identity once. One colour becomes the whole cell, and a repo that already ships a **favicon** needs no configuration at all. Each git worktree can also be handed **its own dev-server port and database name**, and **Grok** joins the Agent Picker (as of 2026-08-05)
>
> **[What's new in 4.3.1](v4.3.1.html)** — the launcher's workspace chip is labelled **`WORKSPACE`** by its role rather than by its folder name, and the **git chip refreshes when you come back to the tab** instead of up to ten seconds later. Nothing to configure (as of 2026-08-04)
>
> **[What's new in 4.3.0](v4.3.0.html)** — the **workspace** reaches the same GUI tools however you start a terminal there, and the launcher **always offers it** as its first chip. The single-view GUI MCP server id is now **`mt`**, so tool names an agent sees are shorter. And an **Enter that confirms a Japanese IME candidate** stays with the IME, in the session note and in the terminal. Nothing to configure (as of 2026-08-04)
>
> **[What's new in 4.2.0](v4.2.0.html)** — a **self-hosted GitLab** works once you name it in `gitlabHosts`, the **Canvas and Tools panes** can take the whole terminal area, a new **worktree inherits its project's settings** one hue step off, and a terminal that stops taking input **repairs itself as you type** or says why it cannot. One key to configure (as of 2026-08-03)
>
> **[What's new in 4.1.1](v4.1.1.html)** — the header's **usage** figure stops sticking at `n/a` on machines where the TUI is slow to start, the phone's terminal returns **300 lines** of scrollback instead of one screenful, and GitLab worktrees get the **PR phase pill** and **⧉ Open PR** that GitHub ones already had. Nothing to configure (as of 2026-08-02)
>
> **[What's new in 4.0.0](v4.0.0.html)** — the **single terminal view is removed**: the grid is the app, focusing on one agent is zooming its cell, and the content surfaces get a **Collections** door in the toolbar. A **worktree now runs one agent session** and refuses a second. The Docker sandbox is gone (as of 2026-08-01)
>
> **Follow us on X** — new releases and features are announced **in Japanese** on X: [Singularity Society (@SingularitySoci)](https://x.com/SingularitySoci). That is where everything ships first, so [**follow @SingularitySoci**](https://x.com/SingularitySoci) to hear about it as it lands.
>
> **[❓ Frequently asked questions](faq.html)** — how it compares to VS Code, Cursor, tmux panes, Claude Squad and Conductor; **whether your existing Claude Code sessions carry over**; Windows; token cost. The things people ask before trying it
>
> **Something looks wrong?** Type `/mulmoterminal-bug-report` in any session. The bundled skill hears the symptom out, checks your **real** config and version to see whether it is configuration or by design, searches the existing issues — and only helps you file one if none of that explains it, with the environment collected and secrets masked.
>
> **Want to change something?** **Open an issue, not a pull request** — outside PRs are closed automatically, whatever their size. That is not a brush-off: the bug we cannot reach from our machines and the idea we have not had are exactly what we are short of. See [CONTRIBUTING.md](https://github.com/receptron/mulmoterminal/blob/main/CONTRIBUTING.md).

**Run a whole team of AI coding agents (Claude Code / Codex) in parallel, on one board** —
MulmoTerminal is the cockpit for that — a browser terminal, so it doesn't care which editor you use.

**Vibe coding with one agent needs nothing but a shell.** What this app is for is the moment you run
**parallel agents** and lose track of which one is waiting on you. The vocabulary is in the
[glossary](glossary.html). The headline features first.

## Highlights

### The grid — a cockpit for parallel agents

![A board of parallel AI-agent terminals](../images/grid-2x2.png)

One independent agent per cell. **Status colors** (working = blue / awaiting input = amber /
done-review = green ring) and an **attention sound** mean you pick up only the cells that call
you — no babysitting. → [Basics](basics.html)

### The cockpit roster — everyone's progress, one row each

![The cockpit roster — a summary list of every session beside one enlarged agent](../images/cockpit-roster.png)

Stay zoomed into one agent while a text list tracks **every session's AI summary, last
instruction, latest reply, and PR phase** (draft / CI fail / ready / merged …). This is the
main screen for running many agents. → [Basics](basics.html)

### Phone push & remote control — walk away, get called back

![Push notifications on a phone's lock screen](../images/push-lock-screen.jpg)

Finished and input-waiting turns send a **Web Push to your phone**; open the live screen there
and answer with one tap (**yes / no / continue**). → [Mobile notifications](notifications.html)

### Worktree isolation & one-click PRs

**Git worktrees** let several agents work the same repo without colliding — diff panel, commit,
push, and **Open PR**, all from the cell. → [Isolating work in a git worktree](worktree.html)

### The GUI panel — a screen beside the terminal

The agent's tool calls render as **diagrams, forms, images, documents, and video/slides
(MulmoCast)**. Your agent hands you an interface, not just printed text. → [Feature reference](features.html)

### tmux persistence — sessions don't die

Sessions survive reloads, reconnects, and server restarts. Leave a long build running and come back.

---

## What people say after switching

> These are experiences reported by users who moved over from an IDE or a split terminal —
> not benchmarks, and not claims we measured. Your setup may differ.

### "It stopped eating my memory"

Keeping several agents apart by opening several IDE windows is expensive: each one brings its own
editor, language server, extensions and file watchers. One user reported a **64 GB machine
stuttering** under that load, and running smoothly after moving over — here the agents are PTYs on
a server and the UI is browser tabs.

### "I stopped answering the wrong agent"

Six panes of scrolling text look identical. Users have described **typing a reply into another
agent's terminal**, and losing track of what they had asked in the first place. As one put it, the
windows all look the same, so switching between them costs time just to work out what you are
looking at.

The problem isn't attention — it's that N identical panes means holding N contexts in your head.
Colour-coded state, a name badge and a per-directory colour move that onto the screen instead.

### "Watching many and reading one stopped being a trade-off"

Splitting a terminal six ways leaves every pane too small to read a long answer without constant
scrolling and resizing — one user described exactly that with a 4,000-character reply. So you
quietly accept worse reading every time you add an agent.

**Grid ↔ enlarge removes that.** Watch all of them, then blow one up and read it properly — the
cockpit roster keeps the rest in view as text while you do.

### "My existing sessions came with me"

Sessions resume as-is — same `claude --resume`, same transcripts. Point it at a directory you
already work in and your history is there. Nothing to migrate, nothing to redo. One user said this
alone made the switch worth it, having previously lost context to killed sessions.

---

**You don't need ten agents for this to pay off.** Users have reported the switch being worth it at
**one to three** parallel sessions. The wins above are about not losing track, not about running
more.

---

## Vibe-coding with AI agents — sound familiar?

As you run more and more terminals and AI agents (**Claude Code** / **Codex**)…

- 📊 you **lose track of which one is doing what** (their status)
- 📁 you can't tell **which directory** each is in
- 💭 even when you know the dir, **what did I even ask it?** (you forget the instruction)
- an agent **finishes and you don't notice** — it waits on you, or you wait on it
- 💥 close the tab or the terminal drops, and **the session is gone**
- 🌿 you want to check git or open a folder, but keep **typing commands for it**
- all you really wanted was to **work fast with the terminal as your hub** —

AI agents take minutes per task. Babysit one and your hands sit idle; add more and keeping track gets harder.
The bottleneck isn't the CPU or the terminal — it's **your attention**.

## Every one of these, handled

| The moment | In MulmoTerminal |
|---|---|
| Can't tell the **status** of many terminals | Lay them out in a grid; **status colors** (working = blue / awaiting input = amber / done-review = green ring) + a sound, at a glance (→ [Basics](basics.html)) |
| Don't know **which directory** | Each cell shows its dir, a **project name badge, and colors**. Color-code to tell them apart (→ [Config](config.html#per-dir)) |
| **Forget the instruction** | The cell header always shows the **latest instruction / what it's doing**; **Activity timeline** shows the **tool-call history** (→ [Feature reference](features.html)) |
| Want to **know it's done** | Input-waiting turns **amber**, a finished turn gets a **green ring**, both **play a sound** — plus a **Web Push to your phone** (→ [Mobile notifications](notifications.html)) |
| Want the **session to survive** | **tmux persistence** keeps it alive across reload, reconnect, and server restart |
| Open **git / a dir** quickly | A git status chip; open **the OS file manager (Finder/Explorer) / the in-app files / a PR** in one click |
| Work with the **terminal as the hub** | All of the above on top of a terminal, and **extend it to your workflow with a DSL** (→ [Config](config.html#header)) |

## The four pillars behind it

1. **Supervise** — the grid is a **cockpit for parallel agents**. Triage by status color + sound; step in only where you're needed.
2. **See** — each agent's **status, model, context, git, tool-call timeline, and cost**, at a glance. What each one is doing and where, always visible.
3. **Automate & investigate** — run scripts in one click (in a **spare cell** next to a running session); when one fails, **turn a wall of logs into a short AI diagnosis**.
4. **Extend (DSL)** — header buttons/chips, launchers, and per-project config via **a small DSL** — it fits any developer.

## Get started {#cli-tools}

If the [`claude`](https://claude.com/claude-code) CLI (Claude Code) runs on your machine and you have **Node ≥ 22.9**,
one command starts it:

```bash
npx mulmoterminal@latest    # opens http://localhost:34567
```

If that didn't work, or you don't know what to install in the first place, everything is on
**[Getting started — from zero to running](getting-started.html)**: opening a terminal,
installing Node.js / Claude Code / git / gh on macOS and Windows, the
[full list of CLIs it drives](getting-started.html#cli-tools), and
[what to do when it doesn't work](getting-started.html#troubleshooting) — one page.

## How to read this guide

1. [Getting started — from zero to running](getting-started.html) (**install and launch, start to finish**)
2. [Basics — what you can do in the grid](basics.html)
3. [FAQ](faq.html) (existing sessions, Windows, token cost, how it compares)
4. [Scenarios — workflows by example](scenarios.html)
5. [Feature reference](features.html) (grouped by the four pillars)
6. [Making the cells talk to each other](conversation.html) (one-turn handoffs, round tables, the room)
7. [Configuration](config.html) (settings modal · `config.json` · `.mulmoterminal.json` · the **DSL**)
8. [Mobile notifications (Web Push)](notifications.html) (iPhone / Android setup)
9. [From your phone](phone.html) (watch, reply with your own chips, start a terminal)
10. [GitHub — cross-repo PRs & Issues](github.html) (open PRs and issues from your registered repos — beside a cell, led by its repository, or on one screen)
11. [Using another model via OpenRouter](providers.html) (run Kimi / DeepSeek / Gemini, with measured data)
12. [Local models with claude-ollama](claude-ollama.html) (fully local, offline, via Ollama)
13. [Glossary](glossary.html)

> The Japanese guide is here: [日本語ガイド](../ja/).
