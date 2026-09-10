---
name: mulmoterminal-config
description: The way into configuring MulmoTerminal, and the way to find out how it is configured now. Use for a broad or unsure request — "configure MulmoTerminal", "set this up", "customize this", "what can I change?", first-run setup — and route to the skill that owns the area. Also answers "how is this set up right now?", "why isn't my setting working?", "did that take effect?" by reading the live config — the global `~/.mulmoterminal/config.json`, each project's `.mulmoterminal.json`, and what the app ACTUALLY parsed from them — including keys it dropped in validation, which is the difference between a setting you never made and one that silently never applied. Owns the global settings that have no skill of their own — work comments on an issue (issueWorkComments), the PR clone footer (prWorkdirFooter), the closing summary (appendSystemPrompt), the decision digest (decisionDigest), the periodic dev-work log (worklogEnabled), roster row length (cockpitLines), the grid header's load read-out (showLoadAverage), pinned collections on the toolbar (toolbarPins), a self-hosted GitLab (gitlabHosts), a project's Skill menu (skills), and a project's Mulmo menu (decks). When the request names another area, go straight to that skill instead — mulmoterminal-dirs (colours, grid order, project names, font size), mulmoterminal-theme (your own colour scheme), mulmoterminal-header (buttons and chips), mulmoterminal-keys (shortcuts, copy-on-select, Enter behaviour), mulmoterminal-model (other models and backends, and your own command for starting Claude Code), mulmoterminal-notify (sounds and push).
---

# Configuring MulmoTerminal — start here

This skill does two things: it **routes** to whichever skill owns what the user wants, and it
**reports** on how things are configured right now. Anything that writes a setting lives in a
sibling skill.

## Where settings live

| Place | What | Written by |
|---|---|---|
| Settings modal | Theme, terminal font size / family / scroll, roster rows, the grid header's load read-out, notification sounds, Push, PR repos, self-hosted GitLab, work comments, PR footer, closing summary, decision digest, dev-work log, copy-on-select, Enter behaviour, launch commands, phone quick commands, MCP servers | the user, in the UI |
| `~/.mulmoterminal/config.json` | Everything global — including the five Settings can only SHOW, never edit: `keymap`, `themes`, `providers`, `customAgents`, `buttons` / `chips` | these skills, or by hand |
| `<project>/.mulmoterminal.json` | Per-project appearance and behaviour. **No UI writes this file** | these skills only |

**Check Settings first when a request is one setting.** Most global settings now have a control
there, so "turn on work comments" is a click rather than a skill run — say where it is and let them
choose. The five above are the exception: a keymap binding, a colour scheme, a backend, your own
Claude Code command, a header button. Settings SHOWS each of them — what is configured now, and for
a backend whether it can be reached — but cannot edit them: they are structured enough to need the
questions a skill asks. Every one of those sections carries a button that launches the owning skill.

## Routing

Ask what they want to change — one `AskUserQuestion`, concrete options — then invoke that skill and
carry on there. Do not re-explain its contents here; the sibling skill is the source of truth.

Two of those areas own a GLOBAL key as well as a per-project one, and the skill owns both halves:
`mulmoterminal-dirs` for `headerStatusColors` / `headerStatusTint` (the header while a session is
running), `mulmoterminal-notify` for the sounds. Route rather than editing the global file here.

| They want | Skill |
|---|---|
| Colours for a project, colour-coding several, grid/launcher order, a name badge, a project icon image, terminal font size or font | `mulmoterminal-dirs` |
| The header being unreadable, or changing colour, while a session runs | `mulmoterminal-dirs` |
| Their **own** colour scheme, appearing in Settings' picker | `mulmoterminal-theme` |
| Header buttons or info chips, globally or per project | `mulmoterminal-header` |
| Keyboard shortcuts, copy-on-select, Enter vs. newline | `mulmoterminal-keys` |
| Another model or backend (OpenRouter, a gateway, a per-project model) | `mulmoterminal-model` |
| Their **own command** for starting Claude Code (`ollama launch claude …`, a wrapper script), offered in the Agent Picker | `mulmoterminal-model` |
| Which moments beep or push, and what they play | `mulmoterminal-notify` |
| Work comments on an issue, the PR clone footer, the closing summary, the decision digest, the dev-work log, roster row length, a self-hosted GitLab | **stay here** — [the settings that live here](#the-settings-that-live-here) |
| Something is broken and they don't know which setting | **Audit first** (below), then route |

If the request already names an area, skip the question. "Make this project blue" goes straight to
`mulmoterminal-dirs`.

**"I want to add my own agent" is two different requests**, and the answer differs by which one:
an entry in the **Agent Picker** that runs Claude Code through the user's command line and receives
Claude Code's arguments (`customAgents` → `mulmoterminal-model`), or a **launcher chip** that runs a
command verbatim with nothing added and no session (`launchers` → Settings' *Launch commands*, which
has a UI and so needs no skill). Ask which before routing: they sit side by side in the launcher and
behave in opposite ways.

Some requests span two skills, and that is normal — say so and do them in order. "Give my new repo
the same look as the others, in my own theme" is `mulmoterminal-theme` (define it once) then
`mulmoterminal-dirs` (pin it and set the colours).

## Audit — how is it configured now?

Reach for this when the user asks what their setup looks like, or says a setting "isn't working".
**Read; do not fix anything until you have reported and they have chosen.**

### 1. The global config

```sh
curl -s "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/config"
```

Falling back to reading `~/.mulmoterminal/config.json` directly is fine, but say which you used.

### 2. Each project

Take `cwdPresets` from the global config — the directories the user actually opens — and for each:

```sh
curl -sG "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/dir-config-detail" --data-urlencode "cwd=$path"
```

Let `curl` encode `cwd` (`-G` + `--data-urlencode`). Interpolating the path raw truncates at the
first `#` or `?` and mangles spaces, and a directory named that way is exactly the one someone
reaches for this audit about.

**Use this route rather than reading the file.** It returns what the app *actually parsed*: the
values in force, which keys the file set, and how each fared — **applied**, **dropped in
validation**, or **not a key we read**. Reading the file tells you what it says; only this tells you
what is in effect, and that gap is the entire content of "I set it and nothing happened". It also
resolves paths the way the app does, so a preset whose project was deleted answers as missing
instead of silently reporting on some other directory.

### 3. Report

Lead with **what is not in effect**, because that is what the user is asking about even when they
phrase it as a general question:

- **Dropped keys** — set in the file, rejected by validation. Name the key, the value, and why.
  For the global config there is no route that reports this: `/api/config` answers the SANITIZED
  config, so an entry present in `~/.mulmoterminal/config.json` and absent from that response is
  precisely one that was dropped. Compare the two whenever a global list (`providers`,
  `customAgents`, `launchers`, `themes`) is shorter than the user expects.
- **Unrecognised keys** — typos survive on purpose (`copyOnSlect` is kept, not deleted), which is
  what makes them findable. Say so; a kept key is not a working one.
- **Set but invisible** — a real setting doing nothing yet. The common ones:
  - `orderPriority` while the grid's ordering button is on auto or manual (the launcher's chips
    still use it).
  - Chrome colours while a session is busy or waiting — the working/attention colours take over,
    and the configured ones only show when the cell is idle.
  - A global change that needs a **tab reload**, or `fontFamily` / a provider key, which need a
    **server restart**.
- **Then** the settings that are working, grouped by area, briefly.

Offer to fix what you found, and route to the owning skill for anything they pick.

## Rules every one of these skills follows

State these when they matter; they are the ones that cost people an afternoon.

- **Global writes are a partial `POST /api/config` merge — at the TOP level only.** Write only the
  keys you are changing; every key you *do* send **replaces** what was there, whole. Nothing below
  the top level is merged, so a key holding a collection has to be sent **complete** or you delete
  the rest of it. That is true of the arrays (`themes`, `providers`, `buttons`, `chips`,
  `soundKinds`, `pushKinds`, `gitlabHosts`, `prRepos`, `launchers`, `customAgents`, `quickCommands`,
  `userMcpServers`, `cwdPresets`) **and equally of the objects** (`sounds`, `keymap`, `repoDirs`,
  `headerStatusColors`) — the objects are the ones that surprise people, because a map *looks* like
  something you can add one key to. Posting `{"sounds": {"waiting": "preset:coin"}}` leaves the user
  with exactly one sound. Read the current value from `GET /api/config`, change it, send it back.
- **`<project>/.mulmoterminal.json` applies live, and writing it with your Write/Edit tool is
  itself the reload signal.** There is **no filesystem watcher**: a file the user edits by hand does
  nothing until something re-reads it. Always write it yourself rather than asking them to.
- **Read the existing file and merge before writing.** Never drop keys the user did not ask to
  change — these files are shared between skills.
- **Malformed values are silently dropped**, so an invalid field just never takes effect. Check with
  the audit above rather than assuming a write landed.
- **When it takes effect**: per-project → immediately. Most global → **reload the tab**.
  `fontFamily`, provider keys, and any hand-edit made while the server is running → **restart the
  server**.

## The settings that live here

None is big enough to warrant its own skill. **All but `skills` and `decks` also have a Settings control** — offer that first, and use these when the user would rather be told the key, or is
setting up a machine without opening the browser.

### `skills` — the header's Skill menu, per project

The header's **Skill** dropdown lists a directory's Claude skills (`.claude/skills`, user +
project scope) and runs the one picked. `skills` is an **allowlist that also sets the order**: an
array (≤ 100) of slugs — only these appear, in this order. **Omit the key** to show every discovered
skill (working-directory ones first). Slugs that don't resolve are ignored.

```json
{ "skills": ["review-diff", "commit-msg"] }
```

### `decks` — the header's Mulmo menu, per project

The header's **Mulmo** dropdown shows a mulmoScript **deck** in the Canvas beside the cell, without
asking the agent. Two sources, and it never searches the disk:

1. `artifacts/stories/` under the workspace — where the plugin puts the decks an agent makes.
   Always offered, nothing to configure.
2. `decks` — an array (≤ 50) of paths **relative to this file**, for a deck kept inside the
   repository.

```json
{ "decks": ["decks/launch.json", "docs/talks/retro.json"] }
```

- Paths must stay **inside the directory that declares them**. `../other-project/deck.json` and an
  absolute path are dropped: `.mulmoterminal.json` travels with a clone, so a declaration names a
  deck kept in *this* repository.
- A path that is not a mulmoScript (no `$mulmocast`), or is not there, is **dropped silently** —
  the menu would open it and the server would refuse.
- Each deck is named by its own `title`, falling back to the file name.
- The menu appears on **agent cells** only (beside Run and Skill), and only under a directory
  MulmoTerminal serves decks from: the workspace it was started in, plus the launcher's saved
  directories — up to 64 in total, skipping any no longer on disk. Those are read **once at
  startup**, so a repository opened for the first time needs a restart before its decks show. A deck anywhere else is still one right-click away in
  the file tree ("Open in the Canvas").
- **Why you list them:** searching for decks finds whatever parses as one, which in a real
  workspace was 217 test fixtures from a checked-out repository against 33 real decks.

### `appendSystemPrompt` — the closing summary

Every session is asked to end a reply with a short summary of what was asked, what was achieved and
what was not, under a `---` rule. It exists for the grid: coming back to a cell later, that is
otherwise only recoverable by scrolling the whole session.

```json
{ "appendSystemPrompt": false }
```

- **On by default**; only an explicit `false` turns it off. Set it globally in
  `~/.mulmoterminal/config.json`, or per project — **the project wins**.
- **Nothing in the app reads what the summary says.** Turning it off costs no feature; the roster's
  "last reply" and push notifications just become the raw tail of the reply.
- Applies to sessions started **from then on**. No restart, but a running session keeps what it
  launched with — reopen the cell.
- `true` / `false` only. There is **no way to substitute custom wording** — do not offer one.
- Independent of `prWorkdirFooter`: both ride on `--append-system-prompt`, and turning one off
  leaves the other.

### `gitlabHosts` — a GitLab of your own

The cross-repo **PRs & Issues** view reads github.com with `gh` and gitlab.com with `glab`. A
self-hosted GitLab cannot be recognised from its address — nothing in `gitlab.example.com` says
which forge runs there — so it is declared:

```json
{
  "gitlabHosts": ["gitlab.example.com"],
  "prRepos": ["gitlab.example.com/group/project"]
}
```

- A declared host then does everything gitlab.com does: the list, starting work from an issue, work
  comments, opening a merge request.
- **`glab` must be logged in to it**: `glab auth login --hostname gitlab.example.com`. Check with
  `glab auth status` — this app holds no token of its own.
- **Hostnames only.** A project path, a port, or a value that is not a hostname is dropped on load,
  which looks exactly like never having written it — audit with `/api/config` rather than assuming.
- Global only, and it takes effect on the **next server start** either way — a hand edit and the
  Settings control are the same write.
- Until a host is declared, its row in the view says so and names this key.

### `issueWorkComments` — telling an issue you are on it

A cell comments **once** on the issue it is working on: posted when the work starts, then **edited**
as the PR opens and merges (closing the issue if the forge has not already). It names the working
**directory** — the folder name only, never the path — so a reader can tell which clone, and two
terminals do not start the same issue twice.

```json
{ "issueWorkComments": true }
```

- **Off by default**, and this is the one setting here that writes to somebody else's repo. Ask
  before turning it on for someone.
- Needs `gh` (or `glab` for a GitLab host) logged in. This app holds no token of its own.
- CI is deliberately never reported: it is on the PR already, and it flaps.

### `prWorkdirFooter` — which clone made this PR

Ends a created PR's body with `work in <clone name>`, so a PR says which of several side-by-side
clones produced it.

```json
{ "prWorkdirFooter": false }
```

- **On by default**; only an explicit `false` turns it off. Independent of `appendSystemPrompt`
  despite both riding on `--append-system-prompt`.

### `decisionDigest` — what this project already decided

Keeps a Markdown digest of the decisions this project's sessions asked for, refreshed on a timer,
for an agent to read before asking something similar.

```json
{ "decisionDigest": true }
```

- **Off by default**: it writes a file (under `~/.mulmoterminal/decisions/`) that would otherwise
  never exist. `mulmoterminal-decisions` is what READS and curates it; this key is the switch.

### `sessionIdleReapDays` — ending sessions nothing is using

Terminals survive a server restart (that is tmux persistence), so they accumulate. At each start the
server ends the ones **nothing is using**: nobody attached, no pty of its own, and no output for this
many days.

```json
{ "sessionIdleReapDays": 7 }
```

- **Default 7. `0` turns it off** — the only way to disable it, and the value to reach for when
  someone parks work in a terminal for weeks.
- **The conversation is not lost.** A transcript on disk resumes without the tmux session; what ends
  is the process and its scrollback. Say this before changing the number — it is the fact that makes
  the sweep safe, and the reason "it has a transcript" is not a reason to keep a session alive.
- Whole days, 0–365. Anything else falls back to 7.
- Also a stepper in **Settings → Sessions that survived a restart**, beside the list it acts on; each
  row there says whether the next start will take it.

### `worklogEnabled` / `worklogIntervalHours` — the periodic dev-work log

A built-in scheduled task that summarizes recent work across the saved working dirs into weekly
wiki pages.

```json
{ "worklogEnabled": true, "worklogIntervalHours": 6 }
```

- **Off by default, and it costs tokens** — each run spawns an LLM session. Say so before enabling.
- The interval is whole hours, clamped to 1–168. Anything else falls back to 6.

### `feedRefreshEnabled` / `calendarSyncEnabled` — the two always-on scheduled tasks

MulmoTerminal registers two built-in scheduled tasks besides the worklog, both hourly: the
collection/feed refresh (one per root — the workspace and every saved project directory) and the
Google Calendar sync. These switch them off.

```json
{ "feedRefreshEnabled": false, "calendarSyncEnabled": false }
```

- **Both default ON.** Only an explicit `false` turns one off — an absent key, `null`, `0` or the
  string `"false"` all leave it running, so an existing config never changes behaviour on upgrade.
  Same rule as `enabled` on a task in `config/scheduler/tasks.json`.
- **Takes effect at the next server start.** The scheduler registers once at boot, so flipping
  either one mid-session changes nothing until a restart.
- Turning one off does not delete anything already fetched; it stops the *scheduled* run. Feeds
  and calendar collections still update when someone asks for them explicitly.
- With both off and `worklogEnabled` off, nothing is registered at all — which is also when the
  scheduler stops writing its state file and run logs.
- Reasons to turn one off: no feeds and no Google account (the runs are no-ops), or a machine
  where the hourly wake-up is unwanted. Neither costs tokens, unlike the worklog.
- Also two checkboxes in **Settings → Sessions**, under *Built-in scheduled tasks*.

### `cockpitLines` — how long a roster row is

How many lines each row of the cockpit roster (the list beside an enlarged cell) shows before it
clamps. Defaults to 2 / 2 / 3.

```json
{ "cockpitLines": { "summary": 4, "prompt": 2, "response": 3 } }
```

- One field per line because they are worth different amounts: a summary says what a session is
  doing NOW, while a prompt is usually done in two lines.
- Each is clamped to 1–20, **per field**, so one bad value cannot discard the two set correctly.
- Raising these trades how many sessions fit on screen for reading a long one in place. It is a
  trade the user makes — do not "fix" a clamped row by raising it unasked.

### `showLoadAverage` — the machine's load in the grid header

Whether the grid header draws this machine's load average beside the 5h / 7d usage windows, as a
percentage of its cores (`load 334%` = 66.8 on 20 cores). **On unless set to `false`.**

```json
{ "showLoadAverage": false }
```

- Amber at 100% (every core has work queued), red at 200%. Hover gives the raw 1 / 5 / 15-minute
  figures, the core count and the multiplier (`3.3x`).
- **A host that keeps no load average shows nothing whatever this says.** Windows is the case:
  `os.loadavg()` returns zeros there, and 0% would read as "idle" rather than "not measured".
- Also in Settings, under **Grid header read-outs**.

### `toolbarPins` — pinned collections on the toolbar itself

Which of the pinned favourites get a permanent button in the toolbar, beside **Grid** and
**Collections**, so opening one is a single press instead of Collections-then-the-row-inside-it.
**Empty by default** — the toolbar is exactly as it was until something is promoted.

```json
{ "toolbarPins": ["collection:works", "collection:todos", "feed:news"] }
```

- Each entry is `"<kind>:<slug>"`, where kind is `collection` or `feed`. The array order is the
  order the buttons are drawn in.
- **Five buttons.** Past that they push the row into its horizontal scroll, which is the very
  two-step this removes. The array may hold more than five: entries whose pins are currently unpinned
  are kept, not drawn.
- It promotes; it does not pin. An entry must already be PINNED (the star in Collections, stored in
  `<workspace>/config/shortcuts.json`, shared with MulmoClaude) — the button's name and icon are
  read from the pin, so renaming a collection renames the button. A key whose pin is gone draws
  nothing and does not hold one of the five slots, and **nothing deletes it** — re-pinning brings the
  button back where it was, once the app re-reads the shared list (page load, or opening Settings'
  Toolbar pins). Do not "tidy" such keys out of the config on the user's behalf.
- The array may hold up to 50 keys while only five are drawn, so a config with more than five
  entries is not an error to correct.
- The shared pin list is read once per page load, and again when Settings' **Toolbar pins** opens.
  So a pin removed in MulmoClaude leaves the button on the toolbar of an already-open session until
  one of those happens; it is not a live feed.
- Also in Settings, under **Toolbar pins**, which lists what is pinned and takes a tick per entry.
