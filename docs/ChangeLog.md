# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

This file records **what changed and why**. For **how to actually use** a new feature, a release may also ship a dated setup guide — linked at the top of its entry, and written as a snapshot of that moment. The living reference is always the [guide](https://receptron.github.io/mulmoterminal/).

## Unreleased

### The Docker sandbox is removed (#1194)

`MULMOTERMINAL_SANDBOX` and its three companion variables — `MULMOTERMINAL_SANDBOX_IMAGE`,
`SANDBOX_MOUNT_CONFIGS`, `SANDBOX_SSH_AGENT_FORWARD` — no longer do anything, and
`Dockerfile.sandbox` is gone. **Setting them is now silently ignored rather than an error**, so an
existing `.env` keeps working; the session simply runs on the host, which is what it already did
whenever Docker was unavailable.

**If you ever ran it**, startup now cleans up after it once: the `~/.mulmoterminal/sandbox`
directory (which held an exported Keychain credential per session) and any `mulmoterminal-<id>`
container still running with your workspace mounted. Both had only one deleter and it went with the
feature. If you never turned the sandbox on, nothing runs — not even a `docker` call.

It was opt-in, macOS-only, and only ever wrapped the single-view session — which a later change
removes. Keeping the sandbox would have meant porting it to the grid, which is the opposite of the
point: it existed to contain ONE interactive session, and the grid runs many. (This release does
not remove the single view itself; that is separate work.)

Nothing else changes. With the flag unset — the default, and how it shipped — every session already
took the host path this now takes unconditionally.

## mulmoterminal@3.0.0 — 2026-07-31

> **Setup guide:** [Start from the issue](https://receptron.github.io/mulmoterminal/guide/en/v3.0.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v3.0.0.html))

The **PRs & Issues** view stops being somewhere to read and becomes somewhere to start. One button
on an issue row cuts a worktree for that issue and opens Claude in it with the issue already in the
input box. Three PRs build that, in the order the pieces have to exist.

**There are no breaking changes.** The major version marks the milestone, not a migration: no config
key is required, nothing moved, and an existing setup keeps working untouched.

### The app now knows that work starts from an issue (#1026)

Until now every part of this was arranged around *directories*, and the connection back to the issue
was re-derived by guesswork at each step — which meant that when a guess missed, nothing happened
and nothing said so.

**Anchor the worktree to its issue (#1171, #1174).** A worktree started from an issue gets an
`issue/<number>-<slug>` branch. The number in the name is what everything downstream reads: the
⧉ Open PR button puts `Fixes #<number>` in the PR body, and the work-item chip, the issue work
comment and the merge-time auto-close (#979) all use the same number instead of inferring one. The
branch the launcher creates for a hand-typed task is unchanged (`agent/<slug>`).

Two defects found while building it, both fixed here:

- The managed worktree's directory name stripped the literal prefix `agent/`, so any other prefix
  would have nested a level below the managed root — created without error and visible nowhere.
- The new branch forked from the **local** base. Several clones of one repo commonly run side by
  side and only the one being worked in gets pulled, so the work started on however old that clone
  happened to be. Measured on this repo: a clone reported `HEAD..origin/main = 0` before a fetch and
  `20` after. An issue-started worktree now fetches and forks from `origin/<base>` — unless the
  local base already *contains* the remote, in which case it wins, because it is then a superset and
  dropping unpushed commits would be a different silent loss.

**Answer which local clone a repo has (#1172, #1177).** `GET /api/repo-dirs` reverses the dir → repo
resolution the app already did: given `owner/repo`, which of the saved directories clone it, ordered
by each one's `orderPriority` then by path, and which one was chosen. The candidates are derived from
`cwdPresets` rather than a second hand-kept list, so adding a clone needs no second edit. Only the
*choice* is stored (`repoDirs`), and it is dropped on read if it no longer names a clone of that
repo — a directory that was deleted or repointed would otherwise send work into the wrong tree,
invisibly.

`prRepos` stays a hand-typed list. Deriving it from the clones would have added repos that are
cloned but deliberately not watched, and removed watched repos with no clone here — both of which
happen in a real setup.

**Start from the row (#1173, #1180).** The issue row's ▶ reads the issue, cuts its worktree and
spawns a Claude session in it seeded with the issue as an editable **draft** — typed into the input
box, never submitted. The body was written by whoever opened the issue, so the Enter belongs to
whoever is about to run it, and the seed goes through the same control-byte stripping that protects
the collection plugin's spawns. A repo with several clones asks once and remembers; a repo with no
clone here disables the button and says why. `dir` arrives from the browser but is checked against
the clones the server itself resolved for that repo, so a request cannot start an agent in an
arbitrary directory.

### A draft could be typed before there was anywhere to put it (#1173)

Seeding a session with a prompt has existed since #548, but every caller spawned into a warm,
already-trusted working directory. Spawning into a worktree created moments earlier broke it, and
the failure was silent: the session came up with an empty input box, indistinguishable from the
feature not existing.

The drift fallback fired **6 seconds after the spawn**. In a fresh worktree claude needs longer than
that to reach any input box, so the fallback pasted into a half-drawn screen and marked itself done
— the text was gone before there was anywhere to put it. It now waits for the output stream to go
**quiet**, re-armed by each burst, which is the shape `attachCodexAutoRun` has always used for an
agent with no readiness marker to wait on.

Two things found alongside it. A directory claude has not seen opens on its **trust dialog**, which
is itself a quiet screen — so quiet alone would paste into the dialog and lose the text; the dialog
gets a much longer window instead. And `draftReadyMarker` (`/shift\+tab to cycle/`) is
**mode-dependent** in Claude Code v2.1.220 — a manual-mode status line reads `? for shortcuts` and
never matches at all, so the marker is now the fast path rather than the only path.

None of this was visible to the test suite, which passed throughout. It took reading the real
terminal with `tmux capture-pane`.

### Park a terminal you do not need to watch (#992, #1165)

A moon button in the cell header dims that terminal — in the tiles, the filmstrip thumbnails and the
cockpit roster row — and stops its working dot pulsing. The session, its connection and its history
are untouched, and the state survives a reload.

The workaround before this was to type `/clear` in the cell you wanted quiet: the header text falls
back through `memo > aiTitle > lastPrompt > session id`, so clearing made it drop to the id and the
cell *looked* empty. Losing the history was not a side effect of that trick — it was its whole
mechanism.

Two safety rules. A cell **waiting for permission never parks**, because missing a permission prompt
because you parked it is an accident, not less noise. And a parked cell that **finishes its turn
stays parked**, since a parked agent finishing is the expected outcome rather than a reason to
resurface. Typing into the terminal wakes it; enlarging does not, because enlarging is how you read
a cell without waking it.

### Fixes

**An enlarged cell rendered at its parked width, permanently (#1178, #1179).** Measured at ~131
columns against xterm's ~237 — the cell's PTY was frozen at the size it had while parked. `Terminal.vue`'s
`onUnmounted` passed `terminalRef.value`, but Vue nulls a template ref **before** that hook runs
(now pinned by a test), so `detach`'s "a newer attach already owns this slot" guard never fired and
every unmount cleared `attachedEl` unconditionally. `fit()` returns early without it, so the cell
stopped fitting, stopped sending resizes and stopped refreshing — the PTY kept its last size while
the browser drew the new one. Reloading fixed it because a new mount re-attached. Same place as the
second unexplained case in #957.

**Hovering a `done` roster row turned it white (#1168, #1169).** The cockpit roster used a lightness
filter for hover, which pushed `done` to `#ffffff` and erased the green state colour. It now mixes
more of the same state colour instead, so the hue holds in every theme — `done` goes `#edfaf2` →
`#d7f5e2`, `blocked` `#fef1dd` → `#fde8c4`.

### Internal

**Shared xterm/WebSocket test doubles (#1166, #1175).** `useTerminalConnections.spec.ts` had grown
to 1020 lines against a 600-line limit, and ~150 of those were scaffolding (an xterm `Terminal`
double, three addons, a `FakeWebSocket`) that any split would have had to copy — so silencing one
warning meant breaking DRY. The scaffolding moved to `test/helpers/xtermDouble.ts` and the spec split
by concern into three files, the largest now 376 lines.

**Codex review no longer tries to run the tests (#1176).** The review job has no dependencies
installed, and on a test-only PR Codex tried anyway and left `vitest: not found` in its review — which
reads as "CI is broken" and cost a round trip to disprove. The prompt now says the dependencies are
absent.

**X account on the documentation site (#1170).** The three landing pages now introduce
[@SingularitySoci](https://x.com/SingularitySoci) and ask for a follow, matching how the README
already does it.

## mulmoterminal@2.9.1 — 2026-07-31

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.9.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.9.1.html))

A fix-only release, both fixes in the **rate-limit readout**. A user running Claude and Codex
together reported that Codex usage never appeared and that Claude's 5h window had no data. Both
halves of that report turn out to be one display bug, plus a second bug that keeps the check stuck.

### The figure beside `claude usage n/a` was Codex's, drawn with no mark (#1161, #1162)

`claude usage n/a | 7d 71%` — that `71%` was **Codex's** seven-day window. The note only appears
when Claude has no window to show, so the neighbouring number cannot be Claude's; but the mark that
says which tool a set of figures belongs to was drawn only when **both** tools reported numbers,
which is exactly what the note rules out. In the one case where the mark was needed it was
structurally guaranteed to be absent, and the line read as "Claude's 7d is 71%, only the 5h is
missing".

The note and the marks are now decided by a single `rateLimitReadout()` that returns both, so a
caller cannot derive them separately and reintroduce the same mismatch. A row with only one tool on
it still gets no mark.

Also confirmed while investigating: current Codex reports a **7d window only**, no 5h, across every
rollout on disk. That is upstream behaviour and was not changed.

### A status line from before the first API response was read as "API-key billing" (#1161, #1162)

Claude Code emits its first status line before the session's first API response, and at that point
`rate_limits` does not exist yet. The store took that window-less report as proof the account has no
windows — which it surfaces as API-key billing — and counted the probe as *answered*.

So when a probe did not finish (trust prompt, slow start, expired login, already rate-limited), the
tooltip explained the missing figures with the **wrong reason**, the failure was never counted, and
the retry stayed pinned to the flat one-hour schedule for `no-windows` instead of the exponential
backoff for a check that got no answer. Every attempt repeated the same path, so the readout stayed
`n/a` indefinitely.

`hadApiResponse()` now distinguishes the two using `cost.total_api_duration_ms` (measured against
Claude Code 2.1.220 on a real PTY: `0` with no `rate_limits` before the response, `2769` with both
windows after). A pre-response status line moves neither the state nor `lastStatusLineAt_ms`, so a
probe that dies quietly lands on the correct `no-report` backoff. Where the field is missing or
unreadable the answer falls back to `false` — concluding nothing from an absent window — because a
wrong `false` only slows a retry, while a wrong `true` is this bug again.

`report(agent, …)` was split into `reportCodex` / `reportClaudeStatus` so no argument can route
around the Claude-side check.

### Also in this release

- A launch plan for the project was added under `plans/` (#1159). Nothing user-facing.

## mulmoterminal@2.9.0 — 2026-07-31

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.9.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.9.0.html))

A release about **whose turn it is**. Three panels list your sessions — the cockpit roster, the
sidebar and the tab bar — and all three used to say "this one needs you" the same way whether the
agent was **stuck on a permission prompt** or had merely **finished and gone unread**. Those are now
told apart everywhere, by colour. The attention beep also stopped losing notifications while the
browser had audio blocked, and an Antigravity conversation now survives a server restart.

### A row waiting on YOU now looks different from one that just finished (#1131, #1139)

The distinction already existed inside the app — `waiting` is set by two different Claude hooks, a
`Notification` (permission or question) and a `Stop` (turn ended) — but only the grid cells drew
them differently. Every list flattened them.

**In the cockpit roster** (the list beside a zoomed cell), a blocked row now carries an amber ring, an
amber leading line and a faint amber tint, and **blinks**; a finished-unread row carries a thin green
ring and does not move. `working` and `idle` are unchanged, and **the row you are looking at is
exempt** — the zoomed row keeps its blue leading edge and never joins in. Settings gets a **Waiting
rows** checkbox (default on); turning it off keeps the colours and stops only the motion.
`prefers-reduced-motion` suppresses the blink regardless of the setting.

**In the sidebar and the tab bar**, the same split arrives as a dot in the slot the spinner uses:
amber for *Waiting for you*, green for *Finished — unread*. Before this the sidebar showed **bold and
nothing else** for both, and the tab bar showed one red dot for both — and `--err-strong` red is too
strong a word for a turn that simply ended. Bold stays on both kinds, because bold means "your
attention", which is also exactly the population of the Unread chip; **the colour is what says which
kind**. There is no blink here and no setting for one: these two panels are always on screen, so
constant motion in them would be far more tiring than in the roster.

The rule that decides the four states moved to one place (`src/components/attentionStatus.ts`,
`activityStatus()`), so the three panels cannot drift apart again.

### Notification sounds are no longer lost while the browser has audio blocked (#1152)

A browser will not play sound before you interact with the page — that part is Chrome's autoplay
policy and no app can opt out. Three things around it were ours, and were wrong:

- **Nothing was held.** While an `AudioContext` is suspended its `currentTime` is frozen at 0, but
  beeps were still being scheduled at `currentTime + …`. Every notification in the silent window
  piled up at time 0 and they all fired **together** on the first click. Measured in Chromium: two
  beeps scheduled a second apart both ended at `0.181`. So "the sound never came back" was really
  "they all arrived at once, on top of the test beep". Nothing is scheduled while the context is not
  running now; the most recent one is held and played **once** on resume.
- **The toolbar lied.** It read `soundEnabled` only, so it said *Attention sound on* while the
  browser was refusing to play anything. There is now a third state that says blocked, and clicking
  anywhere enables it.
- **You could not tell what you missed.** A session whose notification could not be announced now
  carries an unacknowledged ring on its status dot — including one that was already `waiting` when
  the page loaded, which never beeps because the first reading is the baseline.

### An Antigravity conversation survives a server restart (#1096)

`agy` mints its own conversation id and prints it nowhere readable, so MulmoTerminal watches its
brain directory and claims the new conversation after the spawn. That mapping lived only in memory:
restart the server and the conversation was still on disk with nothing pointing at it. It is now
appended to `~/.mulmoterminal/antigravity-conversations.jsonl` and read back at boot, so a cold
reconnect can still run `agy --conversation <id>`. The guard that refuses to resume an id no
conversation matches is unchanged, so a damaged log costs you a resume rather than opening the wrong
conversation.

Session rows also stopped hard-coding `codex` as the only badge — `Session.agent` is a proper
`TerminalAgent` and the badge wording lives in one place, so Antigravity rows can say what they are.

### Fixes

- **Windows: a folder with a non-ASCII name opened the wrong directory (#1146).** The 📁 picker's
  PowerShell writes piped output in the OEM code page (CP932 on Japanese Windows), while we decoded
  it as UTF-8. The ASCII `C:\` prefix survived, so the mangled path passed the absolute-path check
  and the terminal silently opened in the default workspace instead. Both pickers now force UTF-8
  output. This was never CJK-specific — 中文, 한국어, Cyrillic and `café` all broke the same way, and
  the tests cover all of them.
- **A cwd that cannot be resolved is no longer swapped for the default workspace in silence
  (#1151).** `resolveWorkspace` collapsed "no `?cwd=` given" and "a `?cwd=` that does not exist" into
  the same answer, which is what turned the bug above into "it just opened somewhere else". The
  request now reports `default` / `resolved` / `unusable` separately, so a named directory that
  cannot be used says so.
- **Slash commands can be sent from the phone on `esc-cr` hosts (#1142).** While the cursor sits at
  the end of a `/command` or `@path`, Claude Code's TUI keeps its completion menu open and runs in
  the `Autocomplete` key context, where `escape` dismisses the menu — so the `ESC CR` submit never
  arrives as one Alt+Enter. The fix ends such a line so no menu is open when Enter lands, and it is
  applied to **all three** paths that type text and submit it, because the browser's own Skill menu
  had the same dead end.
- **`initialPrompt` is submitted on `esc-cr` hosts (#1148).** The server-side draft injection had
  `"\r"` hard-coded, which on those hosts is a newline rather than a submit. The reported repro (a
  Skill launch button, i.e. `/<slug>`) needed the completion-menu fix above as well.
- **A duplicate `handlers.ts` left behind by the split in #1124 was removed.** Both the old 311-line
  file and its 14 replacements were on main for a while.

### Internal

A large tidy-up wave, all behaviour-preserving. `SettingsModal.vue` (907 lines) became one component
per section with a 147-line shell; `remoteHost/handlers.ts` (311 lines) became 14 files named after
their MulmoClaude counterparts; the empty-cell launch form came out of `TerminalCell.vue`, taking it
from 2020 lines to 1355; `CommandCell` and `LauncherCell` now share `CellShell`; the wiki's page body
and lint report render through one `WikiProse` component; component `<style>` blocks went from 8 to
1; `jscpd` duplicate-code alerts went from 9 to 2; `as unknown as JsonObject` double casts went from
14 to 3 by using core's `toJsonObject`; unused exports are at zero. Two guardrails were added so
these do not silently return: an ESLint `max-lines` error at 600 for product code, and the dead-code
scan now fails the build on unused files rather than reporting them.

## mulmoterminal@2.8.0 — 2026-07-30

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.8.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.8.0.html))

A feature release. **Antigravity joins Claude and Codex as a third agent**, an empty cell can open
your own shell with nothing installed and nothing configured, and a screenshot pastes straight into
the terminal. The fix worth upgrading for is the terminal that came back with its **right side and
bottom blank** and stayed that way through a reload.

### Antigravity (`agy`) is a third first-class agent (#1095, part of #236)

Antigravity now has everything Claude and Codex have: its own WebSocket (`/ws/antigravity`),
conversation resume across a reload, the GUI panel over MCP, and a place in every agent picker — the
single view, grid cells, the sidebar and tab bar, and the Collections browser. Spawned as `agy`, with
`ANTIGRAVITY_BIN` / `ANTIGRAVITY_MODEL` / `ANTIGRAVITY_HOME` to override. Like Codex it mints its own
conversation id, so a watcher over `~/.gemini/antigravity-cli/brain/` claims the new conversation
directory — attributed only when unambiguous — which is what lets a cold reconnect run
`agy --conversation <id>`.

**The GUI MCP registration works differently**, because `agy` takes no MCP flag: it reads its servers
from a file, and the only project-scoped file it reads is `.agents/mcp_config.json`, which is per
**directory** and shared by every session running there. So the registration is written from the
directory's Canvas switches (the same switches Claude's cells read — `infra/gui-mcp-registration.ts`
stays the only registry) and rewritten whenever a switch flips or an agy session starts. The tool
group rides the entry's own `env` because it is a property of the directory; the **session id is
not**, so it is never written to disk — it reaches the bridge through the spawned process's
environment only. Servers in that file that MulmoTerminal did not write are left alone, the file is
removed once no group is on, and it is kept out of your `git status` via `.git/info/exclude` rather
than your `.gitignore` — the same reasoning as `claude mcp add -s local`.

### Tool Call History works for Codex and Antigravity (#1101)

The tools pane's **Tool Call History** had exactly one writer: `POST /api/hook`, driven by the
`Pre/PostToolUse` settings that only `claude` carries. Codex has no hook mechanism and neither does
agy, so for those two the history stayed empty however much they did — while **Available Tools**
directly above it filled up normally, because that half comes from broker registration. Half-alive
reads as broken rather than as missing.

The broker is the one place their work reaches us: every GUI tool call arrives at
`/api/mcp/:sessionId`. It now records start and end around the dispatch, and the existing store,
channel and pane render it unchanged. A **refused** tool (one outside the URL's group) is recorded as
failed — precisely what someone reading the history is looking for — and a failed dispatch closes its
entry rather than leaving `running…` for the life of the session. Recording is fire-and-forget: an
agent waiting on `presentDocument` must not also wait on our history write.

This is a **partial** history — their Bash, their edits and their other MCP servers never touch us —
so the pane says which kind it is showing, computed from the same predicate as the gate, so the
disclaimer and the history can never disagree. Claude keeps using hooks; recording it in the broker
too would list every GUI call twice, and not as duplicates anything could collapse.

### Paste a screenshot into the terminal (#939, closes #938)

Pasting an image into a terminal saves it to that session's drop directory and inserts the **absolute
path** at the cursor (it does not send). It works in **every** browser including Chrome, because the
clipboard carries the bytes and no browser has to disclose a path. Pasting text is unchanged — it
goes to xterm as before.

No new route and no new store: the upload goes through `POST /api/session/:id/drop` from 2.7.0
(#1055), since a clipboard image is a `File` without a path, which is exactly what that route already
takes. The size cap (110 MiB), the destination, the `--add-dir` grant and the cleanup are all
**identical to a drop**. The paste is intercepted in the capture phase only when there is a savable
image **and** no `text/plain` — so copying from a web page, which stacks HTML and an image together,
still pastes as text.

Two related fixes came with it: paste no longer goes dead on **Windows + Chrome**, and the inserted
text now ends with a **space** — pasting twice in a row used to produce `path1path2`, one word
pointing at neither file. That last one also affects drag-and-drop and the file button, by design.

### Settings launches the skill that writes each setting (#1113, closes #1111)

Settings only ever shows the settings it *has* a control for, so anything configured by file reads as
**something the app cannot do**. Theme offered four fixed choices with no hint that `themes` can add
more; Keyboard shortcuts was read-only, with `/mulmoterminal-keys` mentioned in body text; Directory
settings displayed keys the validator had **dropped** without connecting you to the way to fix them.

Four sections gained a full-width button, and `-dirs`' existing one moved onto the same path: Theme →
`mulmoterminal-theme`, Directory appearance → `mulmoterminal-dirs`, Directory settings →
`mulmoterminal-config` (audit), Notification sounds → `mulmoterminal-notify`, Keyboard shortcuts →
`mulmoterminal-keys`. The emit is now `launch-skill(skill: BundledSkillName)` rather than one event
per skill, so adding a button needs no change in the shell.

Pressing one **from the grid no longer throws you into the single view** — the rule is symmetrical
now: you get a cell in the screen you pressed from. When the grid is full (81 cells) the spawned chat
is shown in the single view instead of being silently dropped, decided from `insertCellAfter`'s own
return value rather than a count taken beforehand.

### The config skills split into a router and six writers (#1104, closes #1103)

`mulmoterminal-config` was one 558-line, 31,668-character skill, so wanting to change a colour loaded
all of it, and a single 1,590-character `description` had to win every trigger — which meant it was
the only one that ever could. It is now a **router plus six writers**: `-dirs` (per-directory colours,
`orderPriority`, name, font size), `-theme` (global custom colour schemes), `-header` (buttons and
chips, global and per-directory, with the merge rules), `-keys` (`keymap`, `send`, `copyOnSelect`,
`terminalSubmit`), `-model` (providers, per-directory provider/model), `-notify` (`soundKinds`,
`sounds`, `pushKinds`). The router keeps the audit — reading your real config and naming the keys
validation dropped.

A single read is now at most 12,934 characters. It also picked up settings that are in real use and
had **not one line** in the old skill: `themes`, global `buttons` / `chips`, and `soundKinds` /
`sounds`.

### Launcher chips sit in `orderPriority` order (#1098, closes #1097)

The launcher's directory chips were drawn in `cwdPresets` order, and that array is **MRU** — every
launch moves an entry to the front, so the row rearranged itself constantly and no chip could be
found by position. They now sort by each directory's `orderPriority` ascending, the rule the grid
already uses, so **the side menu and the chips agree**. A directory without one keeps today's
behaviour: after the ranked ones, relative order as stored.

Display order only — the stored `cwdPresets` stays MRU, because `recordPreset`'s "skip the write if
it is already first" and `sanitizePresets`' dedupe both depend on that. `UNSET_PRIORITY` /
`cellPriority` moved out of `gridTabs.ts` into `src/components/dirPriorityOrder.ts` so both readers
share one rule.

### An empty cell can open your own shell, with nothing to configure (#1115, closes #1114)

The launch row in an empty cell is now **Claude | Codex | Antigravity | Shell**. Pick Shell and the
existing "Working directory + ▶" starts your OS default shell (`$SHELL`, else `/bin/sh`) there. No
setting, no launcher entry, no install.

Every part of this already existed — `/ws/launch?shell=1`, `DEFAULT_LAUNCH_CMD`, `CellLauncher`'s
`{ shell: true }` — and a shell could be opened by shortcut, from a running cell's header, and from
the phone. The **one** screen it could not be opened from was an empty cell, which is the first
screen a new user sees. The model picker, the MCP toggles and the worktree box hide when Shell is
selected, since a shell has none of them.

### A terminal blank on its right and bottom, that a reload did not fix (#1116, for #957)

Reported as "it goes like this and does not come back": text wrapping at about 77 columns inside a
terminal about 136 columns wide, the rest of every line and the bottom rows empty. Measured from the
screenshot, that is not a redraw that was missed — **tmux's window really was that size**. Which is
why reloading did nothing: reattaching sends `term.resize()`, the kernel raises SIGWINCH **only when
the size actually changes**, and every recovery path we had could do no more than re-send the size
the PTY already had. Once the window drifted out of step with the client there was no path back.

After a resize settles (250 ms debounce, one probe per burst), the server now asks tmux for the
window size and compares it with the client's. On a mismatch it shrinks the PTY by one row and puts
it back 50 ms later — a **real** size change, and the only one of three candidate repairs that was
measured to work against a live desync. A probe that cannot be answered is treated as **no**
mismatch, since a repair resizes a live session and must not act on an unreadable answer, and a gap
the nudge cannot close is not retried forever. `status off` is now applied to live sessions too, not
just via the conf: a status line eats a row, which would make every comparison read as a permanent
mismatch.

This is a **countermeasure, not a root-cause fix** — the only mechanism reproduced in the lab is a
second client attaching to the same session — so #957 stays open. The repair does not depend on the
mechanism.

### The screen is redrawn after a reattach (#1099, for #1073)

Coming back from a background tab could leave the terminal scrambled: text from different moments
interleaved character by character, the bottom half empty. The replay is a **diff stream**, not a
screen — `entry.buffer` is the trailing 1 MiB of tmux output, so a fresh terminal only reconstructs
the cells that **changed inside that window**, and in a TUI that is the normal state, not an edge
case: Claude Code draws a conversation line once and never touches it again while spending megabytes
rewriting one status row.

Two things used to hide this, and neither holds any more: a PTY resize forced tmux to redraw
everything (but reattaching at the **same** size sends nothing), and the normal buffer reflows (but
the **alternate** buffer does not). So after a reattach the server now asks tmux to repaint the whole
pane (`list-clients` → `refresh-client`), on the first `resize` frame after the reattach — that frame
is what carries the client's settled geometry, and the client always sends one on `onopen`.

### `GET /api/remote-host/status` and `/api/google/status` stop returning 403 (#1100, closes #1094)

With `MULMOTERMINAL_HOST=0.0.0.0` and `MULMOTERMINAL_ALLOWED_ORIGINS` set, a browser on the LAN could
load the page, run terminals and POST — but those **two GETs** returned 403 forever. The exclusion
that keeps safe methods from being origin-checked lived **only in the middleware**, and a route with
its own guard calls the predicate directly, so it never saw it. Browsers do not send `Origin` on a
same-origin GET, so a guard sitting on a GET has nothing to do but reject an honest page. The only
thing special about those two was that they were GETs; the other ten happened to be POSTs.

`requestOriginAllowed(req, isAllowedOrigin)` now lives in `same-origin-guard.ts`, all twelve Express
guards go through it, and `sameOriginGuard` itself calls the same function — one expression of the
rule. Behaviour changes for those two GETs only. This is also the shape the reference host uses:
MulmoClaude's `csrfVerdict` returns `ALLOW` for safe methods before looking at origin or peer.

### A running launcher chip is visible again, whatever colour the directory is (#1107, closes #1106)

Two independent facts were using the **same channel at the same strength**: which directory a chip is
(configured colour, border 55% / wash 14%) and whether a session is running there (blue, border 55% /
wash 14%). That read correctly only while few directories were coloured — and #1103's
`mulmoterminal-dirs` skill made colouring all of them a one-step job. Then a tint meant nothing, a
blue-ish directory looked running while idle, and the 6px dot that was the only distinct marker
disappeared on a blue chip.

One meaning per channel now: **hue on the leading stripe** says which directory, **background,
border and a pulse** say running. An idle chip has no background whatever its colour, and the stripe
carries the colour (8px, replacing the dot). `motion-reduce` drops the pulse — background, border and
dot still say running, so the signal is redundant rather than resting on animation.

### Your session note reaches the cockpit roster and the phone (#1108, #1112, closes #1105, #1110)

The note added in 2.7.0 was missing from **the cockpit roster** when a cell is zoomed: the server was
returning `memo` from `GET /api/session/:id` and the client's `mergeSessionMeta()` was dropping it. It
now sits above the roster row's summary. The cell header and the sidebar were already right.

On the phone it was the mirror image — the note named the session in the **list** but the opened
session's header fell back to the AI summary. `getTerminalScreen`'s response gained `memo?: string`,
fed from the same store. It is an **addition** to the wire shape and changes no existing field, so a
session with no note produces a byte-identical response. It appears on the phone once
receptron/mulmoserver#122 ships; shipping this side first is safe because the phone ignores fields it
was not taught.

### The Windows daily build is green again (#1109)

`test/server/session/pty-spawn-env.spec.ts` passed a literal `"/tmp"` as cwd. Since #1078 `ptySpawn`
stats the cwd before spawning and refuses a directory that does not exist, so on Windows — where
`/tmp` is not a directory — it raised `SpawnCwdError`. macOS and Linux CI stayed green, and only the
Windows daily job saw it. Now `process.cwd()`, which is a directory on every platform. Test-only; the
product code was correct.

### Docs (#1092, #1093, #1102, #1117)

- **One searchable line** across README, npm and the docs site (#1093). The npm description still
  described v1 (no parallelism, no Codex) and the keyword list was missing `codex`; the repo's
  GitHub description, topics and homepage were **empty** and are now set. The line — "Run multiple
  Claude Code and Codex sessions in parallel — a browser terminal grid that shows which agent needs
  you" — is built from vocabulary four interviewed users and two unsolicited posts actually used.
- **Update announcements** now have a route from the README and both guides (#1092): new releases and
  features are posted **in Japanese** on X by [Singularity Society](https://x.com/SingularitySoci).
  The English guide says so explicitly, so nobody follows the link expecting English.
- **Four environment variables that exist and were documented nowhere** (#1102), found by diffing
  what the code reads from `process.env` against what the docs mention: added to the README and both
  guides. Also fixed a `MULMOTERMINAL_HOME` row in the Japanese guide that had been orphaned below
  the table it belongs to.
- **2.7.0's setup guide got its screenshots** (#1117, closes #1090): the session note beside a cell
  header that does not make it taller, and a zoomed cell's divider mid-drag. The prose is unchanged —
  that page stays the snapshot it was written as — and the placeholder "Screenshots" section is gone.

## mulmoterminal@2.7.0 — 2026-07-29

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.7.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.7.0.html))

A feature release. The headline is that a session can now carry **a note you wrote yourself** — but
the fix worth upgrading for is that a second MulmoTerminal no longer deletes the running one's
sessions.

### A one-line note you write yourself, per session (#1086, closes #1084)

Sessions are named by an AI title, the last prompt, or an id — all answers to *what was said*, none
to **what this one is for**. A pencil beside the header text now takes one line of your own.

It **replaces** the header's existing line instead of adding one, so the header keeps a constant
height; the displaced title moves to the tooltip. Storage is per session id, server-side, in an
append log at `~/.mulmoterminal/session-memos.jsonl`, and is **not** dropped on reap — close the
cell, restart the server, resume that session and the note is back. The same note names the session
in the sidebar, the resume picker, and the roster on the phone.

### Draggable dividers in a zoomed cell (#1083, closes #1077)

Zooming a cell splits it into the terminal plus a column. Both boundaries were fixed width, could
not be changed, and nothing was remembered. They now respond to dragging and to the arrow keys, and
the chosen width survives a reload.

### Dropping a file works in Chrome, and from another machine (#1055, closes #993)

Inserting a dropped file's path only ever worked when the browser handed over a real path — which
**Chrome does not do**, and which is never true over a remote connection. Those cases printed a hint
and stopped. Now the bytes are uploaded to the host, saved, and the saved path is inserted. Where a
real path is available the old behaviour is unchanged: it is used directly, with no upload.

### Background workers moved behind a Background chip (#1067, closes #1060)

Scheduled collection syncs and similar unattended work started sessions that were listed among the
user's own chats. They now sit behind a **Background** chip, leaving the default **All** to
human-started chats. Deliberately a filter rather than a removal, unlike MulmoClaude's
`origin: "system"`: a MulmoTerminal session is a live terminal, not a transcript, so hiding it
entirely would remove the only way to inspect — or stop — it.

### `appendSystemPrompt` turns off the closing-summary instruction (#1069, closes #1062)

Every spawned session carried `--append-system-prompt` with the closing-summary instructions.
Nothing in the app parses the result, so it is now optional. Default remains on; settable globally in
`~/.mulmoterminal/config.json` and per directory in `.mulmoterminal.json`, with the directory
winning. Independent of `prWorkdirFooter` — with both off, no flag is passed at all. A config
without the key behaves exactly as before.

### A second instance no longer deletes the first one's session settings (#1066, closes #1061)

`pruneOrphanSettings` removed session settings whose PTY had no tmux session, on the reasoning that
"a PTY without tmux died with the server that owned it". True of a *previous* lifetime, false of a
*concurrent* one: a second instance cannot see the first one's live PTYs, so every one of those files
read as abandoned. Eight live sessions lost their settings on the machine where this surfaced.

Starting another instance now asks first, **whatever port it was given** — previously the prompt only
appeared when the port clashed, so `--port <free>` started a second one in silence. The clash was
never the problem; the shared `~/.mulmoterminal` is.

### The wheel and TUI clicks survive a reattach (#1089, closes #1073)

In Claude and Codex cells, wheel scrollback and clicking the agent's own UI elements died after any
reattach — reload, sidebar switch, another tab, a dropped WebSocket. `?1049h` (enter alternate
screen) is sent exactly once at pty offset 0 and is therefore never inside the trailing 1 MiB the
server replays, so the client restored into the normal buffer with the wheel/click gate stuck false.

Fixed by asking tmux for the current state and prefixing the replay with the matching DECSET. The
alternative the issue proposed — tracking sticky state by scanning the pty byte stream — was not
taken: tmux is the emulator that already holds this state, which removes both DECRST tracking and
CSI sequences split across chunk boundaries. No client change at all.

### `/clear` stops leaving the previous summary in the roster (#1087, closes #1085)

After `/clear`, the cockpit roster kept showing the pre-clear AI summary and reply: gone for a
moment, back as soon as the next turn ended. `/clear` moves the agent to a new session id and a new
transcript, but the hooks are pinned to MulmoTerminal's own id, so `${mtId}.jsonl` becomes a file
frozen at the moment of the clear.

### Session startup failures are diagnosed, not guessed (#1068, #1082, closes #1063, #1078)

The server caught the spawn exception, discarded it, and returned a fixed "codex is probably not
installed". Measured, that text was right only on Windows; on macOS a missing binary produced a green
`[session ended]` instead — symptom and explanation swapped. The binary is now checked before
spawning, in the environment the PTY will actually receive, and what is found is what is reported.

The server log gained three things (#1082): whether tmux **attached or created** — `tmux
new-session -A` attaches to a live session and runs no command, so a resume never launches the agent
and never reveals a broken PATH, argv or cwd, which is why "resume works, new sessions fail" was not
the clue it looked like; a cwd diagnosis, since macOS runs `chdir` in the child and a deleted
directory becomes `_exit(1)` rather than an exception; and the exit detail itself.

### Scheduled feed refreshes report their failures (#1072, closes #1070)

The feeds engine hands hidden workers a one-shot `onComplete`, and `feedsSpawnWorker` destructured
only `{ message, hidden }` — dropping it. A periodic collection refresh that failed was recorded
nowhere.

### `exactOptionalPropertyTypes` is on across the project (#1053, #1081, closes #1048)

Enabled in all four tsconfigs, so `field?: T` means "the key may be absent" and `{ work: undefined }`
no longer type-checks — the exact shape that emptied the phone's session list in 2.6.0 (#1042). The
runtime guard added then only protected the path toward Firestore; everything else passed the type
checker untouched until now. #1053 fixed the same shape at five sites found by the change.

### The remote-host workarounds moved into @mulmoclaude/core (#1051, #1057, #1075, #1088, closes #1064)

Three files carried here (`firestoreSafeResult.ts`, `resilientRunner.ts`, `presenceProbe.ts`, 421
lines) are now core's, on 1.10.0.

Before that, #1051 taught the local guard to separate a **bug** (an `undefined` where none belongs,
which has to be findable) from a **legitimately absent optional field** (warning about which every
poll teaches everyone to ignore the log), and #1057 fixed two holes a local codex review found and
reproduced: the guard rebuilt `Date`, `Map` and Firestore sentinels from their entries, turning a
valid value into `{}`, and the session-activity publisher wrote to Firestore through a path the
guard never saw.

The outer ring is the one worth naming. It had drifted out of step with core's own listen-retry
window — the local copy called a runner recovered after 60s, while core 1.9.0 waited five minutes
before reporting a dead listener, so the outage clock was reset before it could ever reach the
give-up threshold. A host with a dead credential relaunched forever and never asked the client to
re-authenticate, with the UI reporting "online" throughout.

### CI and tests

- **Windows daily is green again** (#1080, closes #1079): red since `622ada44` on both Node 22.x and
  24.x. Both failures were test-side portability bugs — the product code was correct on Windows —
  but each meant the path was never actually verified there. It is now.
- **Temp-dir path spelling** (#1052, #1056, #1059): `realpathSync` returns 8.3 short names on
  Windows while `realpathSync.native` expands them. The implementation was unified first; #1056 was
  its missing test-side pair, and #1059 swept the remaining 12 specs (of 64 that create a temp dir)
  that actually resolve paths, rather than assuming the rest were fine.
- **jscpd** (#1076, closes #1074): three real duplicates removed, 10 alerts down to 7. The remaining
  seven are call sites of something already shared and are kept deliberately — a wrong abstraction is
  worse than duplication.

### Docs

- The 2.6.0 guide was rewritten for end users (#1054): it had been explaining symptoms in terms of
  the implementation.
- README and both guides quote two third-party articles written about MulmoTerminal unprompted
  (#1050).
- The remaining user-facing `npx mulmoterminal` invocations say `@latest` (#1058).

## mulmoterminal@2.6.0 — 2026-07-29

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.6.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.6.0.html))

The release that stops long sessions from reading as empty ones. A transcript that grew past half a
gigabyte made its own session show no title, no timeline and a cost of $0 — and nothing errored.

### A 585 MB transcript no longer reads as an empty session (#1033, #1034, #1037, #1041, #1043, closes #998)

`fs.readFile(file, "utf8")` throws past ~512 MB **whatever the file contains** — V8's maximum string
length, not a memory limit. Nine read sites took a whole transcript that way and each caught the
error and returned "nothing here", so **the biggest and most-used sessions rendered as the emptiest
ones**: no title, an empty tool timeline, `$0` spent. Measured on a real 585 MB transcript, not
constructed.

Rewritten in five phases, behaviour-preserving at each step, around one shared reader
(`server/infra/jsonl-file.ts`): a bounded tail for "what happened last", a line stream for "scan
everything". Two traps are pinned by tests, because both produced a fix that looked right and was
not:

- **A window must not paraphrase the rule it replaces.** Folding "the newest X" by hand loses the
  fallbacks and cross-record semantics of the original. Each phase feeds the ORIGINAL function a
  smaller window, and a test compares the streamed result against the whole-array result on the same
  records.
- **A window sized by guess is worse than no fix.** 256 KB looked generous and held nine records of
  that transcript — not one complete turn — so the exception disappeared while the screen stayed
  empty, which is indistinguishable from a new session. The tail is 4 MB, measured against the six
  largest transcripts on a working machine.

### The usage probe stops holding a session open, and stops leaving transcripts behind (#1030, #1047, closes #1010)

Two ends of the same hidden Claude session that reads the 5h / 7d windows.

**Its transcripts are gone.** Hiding them from `/api/sessions` was half an answer — `claude --resume`
reads the transcript directory itself, so the file has to go. A probe now deletes its own; the ones
left by older versions are swept **once per workspace**, and that "once" is the point: a probe types
its prompt into the real TUI, so what claude records is byte-for-byte what a person typing the same
thing produces. No field separates them. The window in which a content guess can be wrong is closed
rather than reopened on every boot. The guess itself was measured over 7719 transcripts: "contains
the probe prompt" matched 6 real conversations, one of them 974 messages long; "has exactly one user
message, and it IS the prompt, and no tool was used" matched 85 and nothing else.

**It stops the moment its answer lands.** The status line arrives in seconds; the probe was holding a
live `claude` process for the full 90-second timeout after that, and `probing: true` kept every
browser polling at seconds rather than minutes for the whole of it. Only a report carrying windows
ends it — the status line also fires before the first API response, when there are no windows yet.

**An expired figure is no longer shown as if it were current.** A reading whose reset time has passed
describes a budget that has already rolled over, so it is dropped — and dropping it is what makes the
"why is this missing" note appear. Previously a cached figure suppressed that note, so uninstalling
`claude` left yesterday's percentage on screen saying nothing.

Also in this pass: Codex's rollout tail had silently gone from 256 KB to 4 MB when the shared reader
arrived (0.5 ms → 7.9 ms per poll on a 5.9 MB rollout, on the request path), the rate-limit cache was
written synchronously on every poll even when unchanged, and the probe's status line sent an
`x-mt-session` header that route has never read.

### The editor colours the languages you actually open (#1038)

The Files view opened `.vue` as plain text. The file tree was not at fault — the editor knew three
syntax modes: markdown, JS/TS, JSON. Everything else fell through to `text`, so `.py`, `.rs`, `.css`
and `.yaml` were colourless too. Eleven languages added, including `.vue` / `.svelte` / `.astro`
(HTML), `.py`, `.rs`, `.go`, `.java`, `.sh`, `.sql`, `.xml`, `.yaml`.

### The phone session list works again (#1044, fixes #1042)

A regression from #1017: `work` reached Firestore as `undefined`, and `updateDoc()` rejects the whole
document for that — so the reply carrying the session list was never written and the phone showed
**no sessions at all**, timing out after 30 seconds. Not a missing row: the entire list.

### A host that has gone quiet says so (#1046, fixes #1045)

The Mac's toolbar stayed **Online (green)** while the phone said **offline**, and keeping the tab open
did not fix it — the earlier listener-recovery work (#823 / #825) covered a different path. Presence
is written by a 60-second heartbeat, and when those writes started failing nobody was told. The host
now detects that its own presence has stopped landing and shows offline in red, so the two ends agree.

### Smaller fixes

- **`npx mulmoterminal` is now `npx mulmoterminal@latest` everywhere** in the docs and in `init`'s
  closing hint (#1035, #1036) — without `@latest`, npx can run a cached older copy.
- **Windows CI**: preset paths are resolved before comparison, closing a gap left by #1002 (#1029).
- The editor's syntax highlighting is shown in the guide with a screenshot (#1039).

## mulmoterminal@2.5.3 — 2026-07-28

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.5.3.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.5.3.html))

A background probe stops spending the budget it was measuring, and two opt-in settings arrive: raw
key sequences to the terminal, and a record of what a project already decided.

### The rate-limit probe stops re-firing every 90 seconds (#1019, closes #1011, refs #1010)

The usage gauge reads Claude's windows by starting one hidden session and listening for its status
line. When that session reported nothing, **no attempt was recorded** — so the "our reading is
stale" half of the probe gate stayed true and the next poll started another probe immediately. One
report counted 21 runs in half an hour, each one a real query against the very window the gauge
exists to display.

Four failures were collapsed into one silence, and they want different answers:

| Failure | Before | Now |
|---|---|---|
| API-key billing (no `rate_limits` exists at all) | every 90s, forever | the status line *arriving* counts as an answer; asked again about hourly in case billing changes |
| Unanswered trust prompt / expired login | every 90s | exponential backoff, 90s → 3m → 6m … capped at an hour |
| `claude` not installed | spawn threw instantly, so it retried at the *polling* interval — faster than the timeout | decided before spawning, with a PATH lookup; recovers on its own when `claude` appears, no restart |
| Slow boot, transient | every 90s | backoff, reset on success |

The gauge now **says why** it cannot show Claude's numbers, in the place the figures would be
(`claude usage n/a`, with the reason on hover). Previously "not measured yet" and "cannot be
measured here" were indistinguishable, which is why a runaway loop ran unnoticed for half an hour.

The probe's throwaway sessions also stop appearing in `/api/sessions`: it now passes its own
`--session-id`, shaped so it can be recognised without anything being remembered — a process-memory
set would forget its own sessions across a restart while their transcripts remained on disk.
**Sessions created before upgrading still appear**, in the session list and in `claude --resume`,
because they carry ordinary random ids; cleaning those up stays open as #1010.

Also pulled out of `whisper.ts` on the way: `hasBinary` now lives in `server/infra/has-binary.ts`
and reuses the Windows `.exe` / `.cmd` resolution, which the whisper copy never did.

### Send raw key sequences to the terminal (#1023, closes #1005)

`keymap` gains **`send`** — a binding that puts bytes into the focused terminal instead of running
an app action. It started with wanting `Cmd+→` for end-of-line on a Mac:

```json
{ "keymap": { "send": [{ "key": "Cmd+ArrowRight", "bytes": "\u0005" }] } }
```

`bytes` reaches the PTY verbatim; control characters are written the way JSON writes them, and
nothing re-escapes them. It is a **list** rather than a single field like every other keymap action,
because each binding carries its own payload.

### A record of what a project already decided (#1018, refs #1015)

`decisionDigest` (**off by default**) keeps a Markdown digest of the questions a project's sessions
actually asked a human — the options offered and the answer given — at
`~/.mulmoterminal/decisions/<project>.md`, refreshed at startup and every 6 hours. `GET
/api/decisions/digest?cwd=` serves it, and a bundled **`mulmoterminal-decisions`** skill is what
agents read it through, so a question already settled does not get asked again.

The digest holds **dated facts, never inferred rules** — "this user always picks the recommended
option" reads convincingly and can be wrong, and a wrong lesson applied silently is the worst
outcome. Answers where the user rejected every option and wrote their own are kept, because those
say the question itself was wrong.

This release also documents the setting in the guide, which #1018 shipped without.

### Project colours reach every kind of cell (#1013, closes #1006)

The six chrome colours in `.mulmoterminal.json` only ever took effect in Claude cells; Shell
(launcher) and Command cells never defined the CSS variables and fell back to the defaults. Rather
than adding the missing wiring to two more files — the same hole had been found three times — the
wiring moved into one shared place so a new cell type cannot miss it.

### A trailing slash in `cwd` no longer breaks live reload (#1016, fixes #1002)

`existingWorkspace` validated a path without normalising it, so `/a/b/` passed every guard and
became the effective cwd verbatim. That value is used downstream as the *identity* of a directory —
PTY cwd, the cwd returned to the cell, the dir-config subscription key — so one directory had two
names, and an announcement published for `/a/b` never reached a cell opened as `/a/b/`. Normalising
at `resolveWorkspace`, the single gate all seven call sites pass through, fixes the chain at its
source.

### Sessions that survive a restart keep their folder on the phone (#1025, fixes #1021)

A session still alive in tmux after a server restart appeared in the phone list with neither `cwd`
nor a work item. The cause was not that tmux cannot be asked — it was that the server never
remembered. `markDevTerminalSession()` already receives the cwd from its caller; it now records it,
in a **separate** append-log file rather than by changing the shape of `dev-terminal-sessions.json`,
which older versions parse and would drop entirely.

### The phone session list carries each cell's issue / PR (#1017, refs #1014)

Each row gains `work` — the issue and PR numbers, the headline and the phase — so a phone client can
show what the header already shows. Data only; the display lives in another repo.

### CI stops waiting 15 minutes on a hung review (#1022, closes #1020)

`codex exec` does not run slow, it stops: the logs show the PR thread read, then fifteen silent
minutes to the timeout. The job now cuts a hung run short and retries once.

## mulmoterminal@2.5.2 — 2026-07-28

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.5.2.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.5.2.html))

Four built-in themes become as many as you like, and the reasoning behind a change now outlives the
terminal it was made in.

### Your own colour scheme in the theme picker (#1001, closes #996)

A colour scheme written into `themes` in `~/.mulmoterminal/config.json` appears in Settings' theme
picker beside the built-in four, and recolours the whole app — grid, headers, panels and the
terminals. A theme `extends` one of the built-ins and overrides only the tokens it cares about, so
three colours make a complete theme.

Two decisions are worth knowing about. The light-theme rules in `style.css` now key on
`:root[data-appearance="light"]` instead of enumerating the built-in ids — with the id list, a
custom light theme kept the dark-background status pills and became unreadable. And
`themeIdSchema` validates the SHAPE of an id rather than an enum, so a directory's
`.mulmoterminal.json` can pin a custom theme; whether that id exists is checked where the global
`themes` list is in scope.

The guide ships four complete sample schemes — Van Gogh (Arles), Mondrian, Picasso Blue, Matisse —
each with every token filled in and a note on why the colour is where it is.

### A decision log for the workspace (#999, closes #997)

Sessions record the decisions they make into a workspace log, so the reasoning behind a change is
still there after the terminal that made it is gone.

### Windows CI is green again (#1007)

Three specs assumed POSIX-shaped paths and a Unix-shaped `HOME`: `realpathSync` hands back the 8.3
short name on a Windows runner (only `realpathSync.native` expands it), git prints POSIX separators
even on Windows, and `os.homedir()` reads `USERPROFILE` rather than `HOME`. Tests only — no
implementation changed, and `docs/windows-gotchas.md` was corrected where it had sent the author to
the wrong resolver.

### Documentation (#1009 and follow-ups)

The `#782` notes no longer name the canvas renderer as the suspect for the scrollbar and selection
problem — the cause was tmux. The context-window figures were reworded so they do not read as
measurements nobody took.

## mulmoterminal@2.5.1 — 2026-07-28

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.5.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.5.1.html))

The Windows folder picker is the dialog Explorer actually uses, a reply's last code block can be
copied without dragging the terminal's indentation along, and a cell can tell an issue that it is
being worked on.

### Windows: the Explorer-style folder picker (#1004, fixes #1003)

The Working-directory picker opened the legacy "Browse For Folder" tree — no address bar, no path
box — so reaching a project meant clicking down the hierarchy. `winArgs()` used
`System.Windows.Forms.FolderBrowserDialog` under the stock `powershell` (5.1 / .NET Framework),
which has no modern mode; the file picker was already the Explorer-style `OpenFileDialog`, so only
the folder one had been left behind.

It now asks the shell for its own `IFileOpenDialog` with `FOS_PICKFOLDERS`. PowerShell 7 would have
been the smaller change (its `FolderBrowserDialog` is modern), but `pwsh` is not installed by
default on Windows 11, so that would only have fixed it for people who had already installed it.
The COM interop is wrapped in a `try`/`catch` that falls back to the old dialog: a runtime that
cannot compile the interop costs the nicer dialog, not the ability to choose a folder.

Reported by an external contributor with the cause already located down to the function.

### Copy the last code block of the latest reply (#995, fixes #865)

A cell-header button puts the last fenced code block of the agent's most recent reply on the
clipboard. Selecting it in the terminal instead carries every line's leading whitespace, which
mangles a paste into Discord or Slack — this reads the original text from the agent's transcript
rather than off the screen.

### Tell the issue you are working on it (#987, #979 Phase 2)

With `"issueWorkComments": true` in `~/.mulmoterminal/config.json`, a cell comments once on the
issue it is working on, and again when its PR merges — closing the issue if GitHub has not already.
The comment names the working directory by folder name only, never the path, since these land on
public issues.

Off by default: it writes to GitHub under the user's account, often on an issue somebody else
filed. The design problem was idempotency rather than posting — the caller is a poll, so every open
tab re-asks on every tick and a reload asks again. A per-key in-flight collapse handles concurrent
asks, a process memo handles repeats, and an invisible marker in the issue thread handles a
restarted server. A merge is only announced when this session watched it happen, so switching the
setting on does not comment on issues that were finished weeks ago.

### `Opus · ctx 290%` (#986)

`CONTEXT_WINDOWS` is a prefix-matched list and `claude-opus-5` matched none of the `opus-4-x`
entries, falling back to `opus` (200k) against a real 1M window — exactly five times too small.
Opus 5 is listed now, and a percentage that cannot be real is no longer displayed.

### Guide audit (#994)

The configuration, feature-list, basics and advanced pages (8 files across both languages) were
brought back in line with the implementation after 2.2.0–2.4.0, reordered so the most-reached-for
settings come first, given headings that can be found by symptom, and illustrated with three
screenshots of the Settings modal.

### Characterization tests for the `gh` argv (#988, part of #981)

Pins what the four read-side features ask `gh` for, so moving them behind a forge interface can be
shown to keep the observable behaviour identical. Tests only — no implementation touched.

## mulmoterminal@2.5.0 — 2026-07-28

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.5.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.5.0.html))

The rate-limit windows every session shares are now on screen instead of a `/usage` command away,
and a config written by a newer version survives being read by an older one.

### The 5h / 7d windows, in the grid header (#387, #976)

Both windows, for Claude **and** Codex, visible whenever the grid is. Running a grid of agents is
what burns them fastest and nothing in the app showed them; the only way to look was to type
`/usage`, which happens after wondering rather than before.

Where the numbers come from differs per agent, and that decided the design:

- **Codex writes both windows into its own session file**, so reading them costs nothing.
- **Claude has no such file.** The figures exist only in the payload handed to a `statusLine`
  command, and only after a session's first API response — verified by measurement, along with the
  fact that `claude -p` never invokes a status line at all. So MulmoTerminal runs a **hidden session
  of its own**, asks one trivial question, reads the answer, and closes it.

That query spends the budget the gauge reports, so it runs **only while a browser is showing the
gauge** and only when the held value is over ten minutes old. The last reading is cached, so opening
the grid shows numbers immediately rather than after a probe.

A missing window is never drawn as `0%`. Upstream has removed `rate_limits` from the payload once
already (anthropics/claude-code#40094), and a gauge reading zero when the truth is 86% is the worst
thing this data could do.

### Which PR / issue a cell is working on (#979, #983)

Each cell's header now says what that cell is on, as `#977 → #966` — the branch's PR, and the issue
that PR closes. It **disappears the moment the PR is merged or closed**, so a stale chip cannot
outlive the work.

The issue comes from the PR body's closing keyword (`Fixes #966`), which the author wrote on purpose.
A branch named `fix/966-…` is treated as a **candidate only** and shown after confirming the issue
exists — `release/2026-07-28-hotfix` would otherwise be reported as issue #2026, and no pattern can
tell a year from an issue number.

**If you have configured `chips` yourself, add `"work"` to see it.** A configured list is the whole
list, as it always has been; the default set already includes it.

### An older version no longer erases a newer version's settings (#966, #977)

`~/.mulmoterminal/config.json` is shared by every instance on the machine. An older build rebuilt
the file from the fields it knew, so any setting added by a newer one was **silently deleted** the
next time the older one saved — which a preset being recorded on launch is enough to trigger. Found
while testing `copyOnSelect` against a running 2.2.0. Unknown keys now survive a write untouched.

### Also

- **Which clone made a PR** is appended in more of the paths that create one, not only the button (#974).
- **The activity timeline** no longer renders underneath the panel it was opened from (#968, #980).
- **Focus after leaving zoom** returns to the terminal instead of being dropped (#965, #967).
- Dependency updates (#975), and a refactor of the remote-host parsing (#981, #982).

## mulmoterminal@2.4.0 — 2026-07-28

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.4.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.4.0.html))

Reloading the page stopped answering 404 to every `npx` user, the file pane became somewhere a
clicked path can land and something a reload does not empty, and a `.mulmoterminal.json` can now
explain itself.

### Reloading a page under `npx` answered 404 (#954, #963)

Startup worked; the router then rewrote the URL to `/terminals`, and reloading **that** tab
returned "Not Found". Recovering meant editing the URL by hand — and the move that triggers it is
the one made when something already seems wrong: restart the server, reload the open tab to
reconnect.

`send` runs its dotfile check over the **whole absolute path** when given no `root`, and the
default `dotfiles: "ignore"` answers 404. `npx` expands the package under `~/.npm/_npx/…`, so
every npx install failed. The `express.static` mount immediately above passes a `root`, which is
why the assets loaded and only the deep link 404'd — the asymmetry that made it look like a
routing bug rather than a serving one.

Present since vue-router arrived (#161), but the default view was `/` back then, so only someone
who navigated and then reloaded hit it. #883 made the grid the startup view in 2.1.0, putting
every user on a deep route from the first second.

Reported and diagnosed by @ystknsh, down to the line in `send` and a minimal reproduction.

Sweeping the rule across every call site found **a second instance**: `/api/sound` served a
configured sound file the same way, so a custom chime under `~/.mulmoterminal/` never played. The
two fixes differ — a fixed serving root takes `root`, an arbitrary configured path takes
`dotfiles: "allow"` (which the sibling directory-sound route already passed, the asymmetry that
marked this as an oversight). A spec now requires every `sendFile` to say which one it means, so
a future call site cannot forget.

The existing spec tested the route **pattern** only and stayed green through the whole bug; it now
also asserts that index.html actually comes back, from a dist under a dot directory.

### Binding to a non-loopback address now lets that browser attach (#956, #964)

`MULMOTERMINAL_HOST=192.168.11.6` bound the server where it was asked to and then refused the
browser that arrived — the page loaded and the terminals never attached. The allowed origins did
not follow the bind decision.

Naming an address now does both jobs: bind there, and accept a browser that opens it. A wildcard
bind cannot infer what will be typed, so that case still needs
`MULMOTERMINAL_ALLOWED_ORIGINS` (comma-separated). Loopback stays unconditional.

This began as a "spec or bug?" judgement — the guide said the setting was for port forwarding,
not for another machine's browser, and the reported behaviour matched. It was treated as a bug
because the check stopped only honest browsers while stopping no attacker.

### A clicked file path opens beside the terminal that printed it (#910, #953)

The file pane shipped in 2.2.0 with one way in: a toggle in the enlarged cell's header. Clicking
a path in terminal output still either took over the screen (source, via the full-screen view) or
opened a browser tab (Markdown, JSON, CSV) — neither of which is "look at this file while
watching the terminal", which is what the pane exists for.

While a cell is enlarged, the pane now takes the click first, opening itself if it was closed. It
takes everything it can render — the in-app set plus the rendered routes — derived from the two
existing extension tables rather than a third one, so a new extension reaches the pane without a
second edit. Images, PDFs and video keep the browser tab, where they display better than an empty
editor would. A path outside that cell's directory keeps its old route: the pane cannot walk above
its root.

Running it surfaced a defect in the pane itself, invisible to every unit test: the tree and the
open file shared one "latest request wins" counter, and nothing had ever started them at the same
time. Opening a file while the tree was still loading discarded the tree's result, leaving the
file open next to "Empty directory." Fixed with a counter each.

### The pane survives a reload with its file still open (#958, #959)

Whether the pane was open and how wide it was were already remembered; the file and the expanded
tree were not, so a reload dropped you at the tree root. The memory was keyed by cell uid — right
for a session, useless across a reload, since the number is not the same one afterwards.

A directory-keyed copy now goes to localStorage, read only when the in-memory map has nothing.
That entry is handed out **once per session**: it describes the one pane that was on screen before
the reload, not a default for the directory, so a second terminal in the same repository still
starts on its own empty tree.

Nothing snapshotted on the way out either — the state was written only when the pane closed or
re-rooted — so `pagehide` now does.

### Directory colours reach the new-terminal chips (#949, #951)

The directory chips on the new-terminal screen carry a 3px stripe in that directory's configured
colour. A stripe rather than a background tint: the chip's background already means "a session is
running here", and a colour on top of that would collide. A directory with no colour is unchanged.

### A `.mulmoterminal.json` can explain itself (#950, #952)

Settings gained a **Directory settings** section. Opening a row shows the values in effect (colours
with a swatch), which file each came from, **keys dropped in validation**, and **keys this app never
reads** — a misspelt `badgeColour`, or a global-only setting written per-directory. Read-only; writing
is still the `mulmoterminal-config` skill.

It exists for the question "why isn't my setting working", where the answer is almost always in one
of the last two lists and was previously invisible.

### `NODE_ENV=production` leaked into every terminal (#955, #962)

The launcher exported it to every spawned session, and yarn v1 reads it — so `yarn install` skipped
devDependencies **and reported success**. The launcher now adds `PORT` and `CLAUDE_CWD` and nothing
else; a `NODE_ENV` the user exports themselves still passes through. Express's own production
behaviour (no stack traces in error responses) is now set explicitly rather than inherited from the
variable.

### Codex auto-review timed out on large diffs (#960, #961)

The CI review job's timeout is 15 minutes.

## mulmoterminal@2.3.0 — 2026-07-27

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.3.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.3.0.html))

Agents now sign off with what you asked for and what came of it, a mouse selection can reach the
clipboard on its own, and the toolbar says which of its buttons change the view you are in.

### Every session ends its replies with the request and its outcome (#942, #943)

Coming back to a grid cell after a while, the standing request and what came of it were only
recoverable by scrolling back through the whole session. Every Claude session is now spawned with
`--append-system-prompt`, asking the agent to close a reply with a short summary **when it hands
control back** — the work is finished, or it has stopped to ask something.

The summary names the request **for the conversation as a whole**, what was achieved, and what was
not and why. The first of those is the point: after several turns of refinement the agent still
states what was asked at the *start*, folding the later turns in as qualifiers rather than
replacing them.

It deliberately stays quiet mid-work and on replies that involved no work — a factual question, a
greeting — because a block on every turn stops being read. That balance was tuned against a live
model, not written blind: an earlier draft told the agent to stay silent when in doubt, and it then
skipped a *finished* one-file task, which is exactly the moment worth summarizing.

Always on, with no setting. Sonnet and Opus follow it reliably; Haiku was observed ignoring it, so a
directory pinned to Haiku may not see it. Codex sessions are unaffected — the CLI has no equivalent
flag.

The prompt is passed inline rather than as a file, for the same reason `--settings` is: the sandbox
spawn runs in a container that cannot read a host path. It carries no ASCII `"`, which would break
the Windows argv invariant that moved the JSON payloads to files in the first place — a guard test
now sits next to the prose so a future edit fails where the wording is written.

### Copy on select, as an opt-in (#900, #940)

`{ "copyOnSelect": true }` in `~/.mulmoterminal/config.json` puts a mouse selection on the clipboard
the moment it settles, with no key pressed — the PuTTY / iTerm2 behaviour. **Off by default**,
because it changes your clipboard when you may only have meant to highlight something while reading.

This is the first place in the app that writes the clipboard itself. A selection asks the browser
for nothing, unlike the copy *key* added in 2.2.0, where standing back and letting the browser copy
was the whole implementation. Everything below follows from that difference: a whitespace-only
selection and a repeat of the text already there are both skipped, so neither can silently overwrite
something you wanted to keep, and writes are serialized so two quick drags cannot land out of order.

Over plain `http://` the browser gives a page no clipboard access at all, so it falls back to asking
xterm to copy the way the keyboard shortcut does — which works, but needs the terminal to still hold
keyboard focus. It composes with the `copy` keymap action rather than replacing it.

### A star button in the grid header (#932, #937)

One click stars `receptron/mulmoterminal`, authenticated with **your own `gh` login** — the same
authentication the cross-repo PR and issue views already use. The server never holds a token.

The design is mostly about the exit. Once the repo is starred, or once the repository page has been
opened from the button, it never appears again and the app stops asking the server about it at all.
That is why it uses the real star API rather than a plain link: a link can never tell whether it was
followed, so the button could never decide to leave. "Cannot tell" — no `gh`, not logged in, offline
— is kept as a third state distinct from "not starred", so the button hides rather than becoming a
control that does nothing.

### The view switch is fenced off from the rest of the toolbar (#941, #947)

**Chat** and **Grid view** are the only buttons in the header nav that change *which view you are
in*; Collections, Wiki, Pull requests and the rest all act within the view you are already in. They
sat in one evenly-spaced row that hid the distinction. The pair is now grouped behind a rule — the
same treatment the grid's status tally already had at the other end of the nav — and carries a
`role="group"` so the structure reaches a screen reader too, which a border alone never does.

### The directory in the enlarged-terminal side list truncates from the front (#944, #945)

Enlarging a cell puts the other sessions beside it as a roster, and the directory on each row was
cut from the *end*. The column is narrow, so what disappeared was the project name — the part you
were actually reading — leaving the prefix every path shares. It now truncates from the front
(`…rminal2/src/components`), matching the grid cell headers, and the full path is in the tooltip.
The filmstrip thumbnails had the same problem and got the same fix.

### History tabs are readable on dark themes again (#946)

Idle session tabs in the second toolbar row rendered as pale grey text on a pale grey box. The app
builds Tailwind **without preflight** on purpose — every existing component uses scoped CSS, so a
base reset would repaint all of it — which means a `<button>` with no `bg-*` falls back to the
browser's default `ButtonFace`. The tab bar styled only the active side, so idle tabs picked up the
UA button face and put `text-secondary` on top of it. They now declare `bg-transparent` and let the
bar's own background through. All four dark themes were affected; an audit of every `<button>` in
`src/` found this was the only one missing a background.

## mulmoterminal@2.2.0 — 2026-07-27

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.2.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.2.0.html))

The in-app file explorer moved next to the terminal, and editing it stopped being able to lose
your work — or the agent's. Alongside it: the mouse no longer zooms the page out from under
you, the notification bell can tell "finished" from "waiting", and the terminal gained keyboard
copy/paste.

### The explorer and editor open beside an enlarged terminal (#910, #925)

Until now the file explorer was a **full-screen** view: to read a file you covered the terminal
you were reading it for. Enlarge a grid cell (**⤢**) and its header now carries a **folder**
toggle that splits the enlarged area — terminal on the left, the same explorer + editor on the
right, rooted at that cell's directory. Drag the divider, or focus it and use ←/→, Home, End.

It works in **both** zoomed layouts (cockpit roster and thumbnail filmstrip). The pane re-roots
as you walk the zoom between terminals, and whether it is open plus how wide it is are
remembered per browser. The terminal keeps a minimum width, so a squeeze shrinks the pane
rather than reflowing xterm into garbage.

Nothing was rebuilt for this: the full-screen view and the pane are the same component, so
Markdown preview, syntax highlighting and everything else came along unchanged.

### A save can no longer overwrite the agent that edited the same file (#910, #916)

The editor sits in a directory where **an agent is writing the same files**. Saving used to
send the buffer and let the last writer win, so "open a file, let Claude rewrite it, press
⌘S" silently threw away what Claude wrote.

Reading a file now returns a **version** alongside its text, and saving sends that version
back. If the file changed meanwhile the write is **refused (409)** and nothing is written; a
banner offers to reload the disk's copy or to overwrite deliberately. The version is a content
hash rather than a timestamp — a one-second-resolution filesystem, or two writes inside a
clock tick, would report "unchanged" for exactly the race this guards.

### Three generations of every file the editor touches (#910, #926)

Opening a file, and replacing one, keep a copy under `~/.mulmoterminal/backups/`. **Outside the
project**, so a `.bak` never shows up in `git status` or in the agent's view of its own repo.
Re-opening unchanged content doesn't rotate a generation in, and a backup that can't be written
never blocks the read or the save it was taken for.

### Leaving an open file saves it, instead of asking (#910, #928)

The editor sits beside a terminal you are working in, and the enlargement moves from keys and
filmstrip clicks — so `Discard unsaved changes?` interrupted the very flow the pane exists to
sit beside. Switching files, moving the zoom, closing the pane, navigating away and closing the
tab now **save** instead of prompting. What a save replaces is in the backup store, which is
what makes not asking defensible.

A parting save that loses the version race can't raise a banner — you are already leaving — so
your version is **banked** and the file left as the other writer left it. If neither the save
nor the backup lands (server down, disk full), anything that *can* stay does: the file doesn't
switch, the pane doesn't close, the tree doesn't re-read.

### An open file that changes on disk says so, before you save (#910)

The 409 tells you at the moment you save. Now you usually know sooner: Claude's write hook
already reports every tool call, so a write to the file you have open reaches the editor
**immediately** — and a **30-second** version check covers everyone the hook cannot speak for
(Codex reports through a different channel; git, builds and other editors through none).

A **clean** buffer simply takes the new content, so the pane reads as a live view of what the
agent is doing. A **dirty** one raises the banner instead of choosing for you. No filesystem
watchers: each terminal's directory is somewhere else, and on Windows a watch on an 8.3 short
path can abort the process outright.

**Two paths remain unguarded**, both noted in the code:

- Closing the **full-screen** view outright unmounts the editor, so if the backup store is also
  refusing writes at that moment, the buffer is gone.
- On tab close the browser caps a `keepalive` request at **64 KB**, so a very large unsaved
  buffer may not make it out.

### Per-cell memory for the pane (#910, #929)

Walking the zoom between terminals no longer means re-opening the same three directories. Each
cell remembers which directories were open and which file — **saved state only**: the buffer
went to disk (or the backup store) on the way out, and the content is re-read from disk on
return, because the agent has usually rewritten it since. In memory, so a reload starts clean:
paths remembered from a previous session may not exist any more, and restoring them would only
mislead.

### The mouse no longer zooms the page (#896, #901)

`Ctrl`+wheel — which is also what a trackpad pinch arrives as — rescaled the whole page,
dragging the layout and xterm's fit with it. Both are ignored now. Keyboard zoom
(`Cmd`/`Ctrl` `+` / `-`) still works when meant, and a phone's finger pinch is untouched; the
in-app font size is the way to make terminal text bigger, since it re-fits the PTY.

### Keyboard copy and paste in the terminal (#900, #933)

Two `keymap` actions, `copy` and `paste`. **Nothing is bound by default** — any key bound here
is taken from the terminal underneath. They dispatch inside the terminal rather than from the
grid's handler, which matters twice: the grid ends every match with `preventDefault()`, and for
paste that would cancel the browser's own paste (which is what actually inserts the text),
while `copy` has to fall through when there is no selection so `Ctrl+C` still sends `^C`.

### Notification sounds per kind, and one storm fixed (#873, #917, #874, #927)

The bell can sound differently for **finished** and **waiting**, each switchable on its own,
with presets shipped so no file of your own is needed.

The fix that comes with it matters more: a **subagent** finishing raised the "it wants you"
notification while the main agent was still working. On a long run with many subagents that was
a stream of false alarms.

### Ordering the grid by directory (#876, #881)

`orderPriority` in a directory's `.mulmoterminal.json` decides where its cells sit — lower
first. Directories without one keep the existing behaviour.

### Directory settings reach the cells that were missing them (#906, #911, #915)

Shell (launcher) and Command cells now carry the directory name badge and follow that
directory's theme and font, which terminal cells always did. The resolution of those settings
moved into one place (`Terminal.vue`), retiring four separate `dir-*` prop wirings — the reason
the three cell types had drifted apart in the first place.

### A configurable terminal font, with CJK in the default stack (#864, #870)

`fontFamily` sets the terminal's font. The default stack now carries CJK faces, so Japanese in
the terminal stops falling through to whatever the browser picked — which is what misaligned
box-drawing frames.

### Collections push to Google Calendar (#897, #907)

Following `collection-plugin` 1.2.x. The route path and the status-vs-body split were matched
against MulmoClaude's implementation rather than guessed, which is what made the difference
between "works" and "works the same way in both hosts".

### `addDirs` (#908, #912)

`.mulmoterminal.json` can pass extra `--add-dir` arguments to the agent.

### Fixes and test debt

- A **git chip** squeezed into a narrow cell collapsed into what looked like an empty badge (#921, #922).
- `fetchJson` swallowed the server's explanation and showed a generic error instead (#913, #920).
- Mounted components were left behind by specs, which is how flakes appeared in unrelated files (#903, #904, #918).
- Font changes reaching the PTY — the point of #860/#864 — had no test (#919).
- Windows CI: POSIX path literals in specs, and an `add-dirs` test that assumed them (#923, #934, #935).
- The immediate (hook-driven) half of external-change detection had no test; only the 30-second poll did (#936).

## mulmoterminal@2.1.1 — 2026-07-27

> **Setup guide:** [What changed in this release](https://receptron.github.io/mulmoterminal/guide/en/v2.1.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.1.1.html))

A follow-up to 2.1.0's grid-first startup: the header now carries different buttons in each view, and a full-screen panel returns you where you opened it. Nothing to configure.

### The toolbar differs between the two views (#886)

With the grid as the startup screen, the screen for **supervising agents** was leading with buttons for **reading content**. The grid now keeps New terminal, cell ordering and the status tally, plus **Pull requests** and **Worklog** — the two things you consult *while* supervising. Collections, Accounting, Wiki and pinned favourites moved to the single view, where those surfaces belong. Both views keep the chat / grid pair, or a user could get stranded in whichever view they were in.

Worklog also moved out of the right-hand end of the header into the grid's own row, next to Pull requests.

### Closing a panel returns you where you opened it (#886, #889)

Collections, Wiki, PRs, Accounting and Files each render below the header. Closing one pushed to the single view unconditionally, so opening Pull requests from the grid and closing it moved you off the grid. The origin now rides the **history entry**, so browser back/forward restores that entry's own origin rather than a stale one, and a direct load — which has no origin — still falls back to the single view.

Three things had to line up, and getting them from one flag is what made the first attempt worse rather than better:

- **Which buttons the header offers** follows the view *underneath*, so an overlay opened from the grid keeps the grid's buttons instead of hiding the one just clicked.
- **Which button is highlighted** follows the route — an open panel is not the grid even when the grid is underneath. Sharing the first flag lit up Grid view and Pull requests at once.
- **Which shell renders** follows the route too. The overlays live inside the single view's block, so widening that check stopped them rendering at all: the URL changed and the grid simply stayed on screen.

A second defect only a real click-through found: hopping from one panel straight to another (grid → PRs → Worklog) recorded the *previous panel* as the return target, because each surface tested "am I already inside **my** overlay?". Capturing the origin only when the current screen is not itself a panel collapses entering, moving around inside, and hopping between panels into one rule — and removes the per-surface route lists that had to agree with each other.

## mulmoterminal@2.1.0 — 2026-07-27

> **Setup guide:** [How to use what this release added](https://receptron.github.io/mulmoterminal/guide/en/v2.1.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.1.0.html))

The app opens on the grid now, the terminal font size and the cockpit roster become adjustable, and a PR says which clone it came from. **One behaviour changes without asking**: the screen you get on startup. Everything else is opt-in or purely visual.

### The default view is the grid (#883)

`http://localhost:34567` lands on the grid instead of the single view; the URL settles on `/terminals`. The single view keeps working and now has an address of its own, **`/chat`** — bookmark it to start there instead.

The change is four lines in the router, but the risk was not there. `router.push("/")` meant "back to the single view" in six call sites — including the toolbar's own Chat button, which would have started flying to the grid. All six navigate by route NAME now, which is what makes `/` a one-line decision rather than a fact spread across the codebase. A **seventh** site was found only by the tests: `useFilesView` fell back to the string literal `"/"` when a `/files` entry carried no origin, a shape no `push("/")` grep would surface.

Two consequences worth stating: a mistyped URL now lands on the grid, and opening the app no longer attaches the single view's terminal — that session lives in tmux, so it returns the moment you open `/chat`.

### Terminal font size, globally and per directory (#860, #866)

`fontSize` was hardcoded in the xterm constructor. The Settings modal now has a stepper (remembered **per browser**, so a phone and a desktop on one server keep their own), and a directory's `.mulmoterminal.json` can set `fontSize` to win for its own terminals. Range 8–32, default 14; out-of-range clamps, non-numbers are ignored.

The part that isn't plumbing: a size change alters the cell metrics, so `cols`/`rows` change and the PTY has to be told. Setting the xterm option alone would reproduce exactly what makes browser zoom useless here — xterm's grid and the shell disagreeing about the geometry, so the cursor and the wrap points drift.

### Cockpit roster line counts (#877, #880)

How many lines each roster row gives the AI summary, the last prompt and the latest reply is now `cockpitLines` in `~/.mulmoterminal/config.json`. **Defaults are 2 / 2 / 3 and omitting the key changes nothing.** Raise `summary` to read what an agent is doing without zooming in.

Originally proposed and implemented by @meki-nana in #863.

### A PR says which clone it came from (#872, #879)

With several checkouts of one repo side by side — `myrepo`, `myrepo2`, `myrepo3` — a PR on GitHub said nothing about which produced it. A PR created with **⧉ Open PR** now ends its body with `work in myrepo3`: the name of the MAIN checkout, not the worktree, since the branch is already on the PR.

`--body` on `gh pr create` replaces what `--fill` derived from the commits rather than adding to it, so the line is appended in a second step — and because both steps run after the PR exists, a failure there logs and leaves the PR reported as created. Three guards keep it from stacking: only newly created PRs, an idempotent append, and no write at all when the body would not change. On by default; `prWorkdirFooter: false` opts out, read per PR so no restart is needed.

### The interface uses icons, not emoji (#875)

Every emoji in the UI is a **Material Symbols** glyph now — cell toolbars, overlays, menus, the settings modal — with tooltips and labels unchanged. A header button in config takes `icon` (a Material Symbols name); `emoji` still works and still wins when both are set, so existing configs render exactly as before.

Screen readers were part of this: a Material Symbols span carries its ligature name as real text, so "Run" was announcing as "play_arrow Run expand_more" until every decorative icon span became `aria-hidden`.

### Outside pull requests are closed automatically (#867, #868)

A pull request from outside the development team gets a comment pointing at [CONTRIBUTING.md](https://github.com/receptron/mulmoterminal/blob/main/CONTRIBUTING.md) and is closed, regardless of size. **Issues stay welcome** and are the way in: open one, agree on a plan, a maintainer writes the PR. The rationale — reviewing a large unfamiliar diff costs more than writing it, and this app runs agents against a user's real machine — is in that file.

### Also in this release

- **Windows:** the buffer-health fuzz test no longer fails on a slow runner (#858, #859).
- Dead types and the two actionable lint warnings are gone (#869); merged plan files moved to `plans/done/` (#871).

## mulmoterminal@2.0.1 — 2026-07-26

Hardening of the local server's network surface, plus a dated setup guide for each recent release. **Upgrading is recommended.** Nothing changes for an ordinary local install.

### The server listens on loopback by default (#856)

`server.listen()` was called with no host, so Express bound every interface — and this server has no authentication of its own, so `/api` routes, the terminal WebSockets and the routes that spawn a PTY answered whoever could open a socket. It binds `127.0.0.1` now.

`MULMOTERMINAL_HOST` widens it deliberately, which is what a container or WSL forwarding a port needs. The startup warning that fires when the binding is not loopback is classified from `server.address()` — what the OS actually bound — rather than from the string that was requested: `localhost`, `127.1` and `127.000.000.001` are all ways to ask for loopback, and a hosts file can point `localhost` somewhere else entirely. A warning that fires on a safe setting teaches people to ignore the one that matters.

The same-origin predicate also stopped inferring that a caller must be local. It had trusted any request without an `Origin` header on the grounds that the server "binds to 127.0.0.1 so remote traffic can't reach us" — an assumption nothing enforced. It takes the peer address now and checks it, so that trust is verified rather than assumed, and the argument is required so a call site cannot omit it silently.

### One same-origin gate for state-changing requests (#857)

Loopback is still reachable from the user's own browser, so a site they visit can `POST` to `localhost`. It cannot read the reply, but the side effect lands. A cross-origin JSON body is already stopped by the failing preflight, and a simple request arrives with a body `express.json` does not parse — so the exposure was small. The shape was the problem: of 46 state-changing routes the origin check was on some and not others, and a route added later inherits whatever the author remembers.

The gate sits ahead of every route. Safe methods pass — gating them would not stop a cross-site `<img src=localhost>`, which sends no `Origin` at all, and would break the media loads that cannot send a header. The `view-data` endpoints are exempt: a custom collection view is sandboxed HTML with an opaque origin by construction, carrying an HMAC capability token scoped to one slug, which is both stronger than an origin check and incompatible with one.

### Dated setup guides for recent releases (#854)

The changelog records what changed; it does not say how to turn a thing on, and for something like `keymap` there was nowhere obvious to look. Each release now ships `docs/guide/{en,ja}/v<version>.md` — open this file, paste this, restart what, how to tell it worked, what breaks on a Mac — written as a snapshot of that moment, with the date in the first line and links out to the living guide for whatever changes later. Eleven releases, both languages, linked from the top of each changelog entry. A fix-only release gets one too, answering the question an upgrader actually has: nothing to configure, here is what was broken, here is how to tell you have the fix.

## mulmoterminal@2.0.0 — 2026-07-26

> 📘 **[How to use what this release added](https://receptron.github.io/mulmoterminal/guide/en/v2.0.0.html)** — step-by-step setup for the keymap, Push kinds and the phone features, written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v2.0.0.html))

Keyboard shortcuts arrive, Web Push becomes selective, and the phone companion gains three abilities. Nothing here changes an existing install's behaviour: the keymap is empty until you write one, and Push keeps notifying exactly as before unless you narrow it.

### Keyboard shortcuts — a user-defined keymap (#837, #843, #841)

Drive the grid without reaching for the mouse. **There are no defaults**, deliberately: every key you bind is one the program inside the terminal stops receiving, and only you know whether that trade is worth it. Bindings live in `~/.mulmoterminal/config.json` under `keymap`.

- **`zoom-toggle`** — enlarge / collapse, and the ONLY action that changes that. It enlarges whichever terminal the cursor is in, and collapsing leaves the cursor there, so a round trip never loses your place.
- **`next-attention`** — move to the next terminal worth looking at: awaiting input, then finished-and-unreviewed, then idle, skipping anything mid-turn. Cycles rather than stopping at the end. Zoomed it moves the enlargement; un-zoomed it moves the keyboard focus, switching page if the terminal is on another one.
- **`zoom-next` / `zoom-prev`** — walk the enlargement along the on-screen order.
- **`terminal-new`**, **`terminal-new-adjacent`** (beside the current terminal, inheriting its directory — the nearest thing the grid has to a split), **`terminal-close`**.

Modifiers match exactly, so binding a bare key leaves `Shift`+key to xterm's scrollback. A **malformed binding stops the server from starting** and prints the offending line: a silently dropped typo looks identical to a shortcut that simply does not work, which sends people hunting in the app for a one-character problem in a file. An unknown action name only warns, so a config written for a newer version still loads. Two actions on one keystroke warn, naming the one that actually fires. **Settings → Keyboard shortcuts** lists every action and its binding — including the unbound ones, since that is how the actions are discovered at all.

The guide carries five ready-made keymaps (minimal, arrow-keys, tmux-flavoured, iTerm2-flavoured, supervising-many-agents) and the platform traps, documented from Apple and MDN: on macOS the top-row keys are media keys and deliver no keydown at all without `Fn`, `Option`+letter arrives as the composed character rather than the letter, and `Cmd`/`Ctrl`+`W`/`T`/`N` are reserved by the browser and can never be bound.

### Web Push, per kind (#851)

Push fired on both finished turns and permission prompts, with one global on/off as the only control — so asking to be told when a task finishes also meant a notification on every permission request during it. `pushKinds` chooses which moments notify, from Settings. An unset value keeps both, so upgrading loses no notifications; an explicit empty list silences every kind while leaving the toggle on.

### Phone companion (#836, #840, #844, #849)

- **Launch a terminal from the phone**, in the working directory of the session on screen.
- **Quick-reply chips you define yourself**, tapped to drop your own phrases into the input box.
- **A link to GitHub** from the session screen when the directory is a GitHub repository.
- A guide page describing what the phone can ask this host to do.

### Fixes

- **A terminal killed by xterm recovers in place** instead of demanding a page reload (xterm 6.0.0 buffer corruption, #846 / #848).
- **Clicks reach clickable elements inside a TUI again**: the click reports that disappeared when #729 was reverted are synthesised (#847).
- The phone's GitHub link points at the repository root — the `tree` form 404s on some repositories (#839).

### Maintenance

- `@mulmoclaude/core` → `^1.6.0` and `material-symbols` → `^0.45.9`, with the lockfile deduped. A nested copy of core 1.5.0 was genuinely installed alongside 1.6.0, so its module state was not shared and its native bindings initialised twice (#853).
- `isRecord` is one implementation in `common/` instead of 29 local copies, and it rejects arrays (#828 / #852).
- Documentation: how a clicked file path routes by extension (#835), the docs-site link at the top of the README (#838), and the fact that `yarn typecheck` does not compile the specs — only `typecheck:test` does (#842).

## mulmoterminal@1.12.0 — 2026-07-26

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.12.0.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.12.0.html))

No new features — this release is entirely durability and correctness work, plus a dependency refresh. Every item below is a failure a 1.11.1 user can hit today without being told why.

### Your configuration can no longer be destroyed by a crash

- **`saveAppConfig` wrote non-atomically** (#822): `writeFileSync` truncates the destination and then fills it, so a crash, a kill, or a full disk mid-write leaves a half-written `config.json`. The next boot reads that as corrupt, and the lenient loader turns corrupt into an empty config — every provider, launcher, and header button, gone. `server/files/atomic-write.ts` exists for exactly this ("so a crash mid-write can't leave a truncated one behind") and was already used by feeds and scheduled sessions, but not by the file whose loss costs the most. It has a synchronous sibling now, and both `saveAppConfig` and the cwd presets go through it. A failed rename throws, which the callers already report as "the save failed" — with the previous file still on disk, which is the point.

  No retry loop in the sync version on purpose: the async one can wait out a Windows lock, but a synchronous caller cannot stall the event loop. The writer and renamer are injected, because the property that matters — that the destination is never opened for writing — is invisible from outside; the difference only shows if the process dies between the two calls. The first version of these tests passed just as happily against a plain `writeFileSync`, so they now assert on the calls themselves.

- **API tokens outlived their sessions** (#822): `cleanupSessionSettings` only ran from `reap()`, which a crash never reaches. What stayed behind was not inert — a provider session's settings file holds its API token, so the token survived the session, survived being rotated or revoked, and survived the provider being removed from the config. Boot now prunes every settings file not backed by a surviving tmux session; nothing else can still be reading one, since a PTY without tmux died with the server that owned it. Files belonging to live sessions, and files we did not write, are left alone.

### The phone link recovers instead of going quietly dead

- **The Firestore command channel stopped for good after a sleep or a network change** (#823, #825): `@mulmoclaude/core`'s `startHostRunner` gives up on its listener permanently — a non-transient error stops it outright, and a transient one only survives five retries (~31s). Anything longer outlasts it, so the host went offline while the toolbar still showed the last state it happened to fetch. The first sign was the phone failing to connect, with nothing on the Mac but a single server log line.

  - **`resilientRunner`** re-subscribes on core's behalf and gives up on **time** (5 min) rather than a retry count, then passes the closure through so the client can escalate to a full re-auth from its parked blob.
  - **The listener error text core drops on the floor is kept**, logged, and surfaced.
  - **`healthNotice`** raises an urgent bell entry when the channel gives up, cleared when it comes back — asked of the notifier rather than remembered, so a notice raised before a restart is still found.
  - **`/api/remote-host/*` responses now carry `health`** (`online` / `reconnecting` / `offline`, plus the last listener error), and the toolbar shows **Online / Reconnecting… / Offline** with the cause.
  - **A 30s poll** keeps an idle tab from going stale and from never firing its auto-reconnect.

  Escalation is staged: re-subscribe for the first 5 minutes (backoff 1s→60s, which covers sleep and network moves), then give up to disconnected with a bell notice while the client re-authenticates from its parked blob (the only path that fixes an expired token), then discard the blob and prompt for Connect if that 401s. `lastError` is cleared on confirmed recovery, so a later outage cannot report a finished incident's cause. The wrapper coexists harmlessly with a fixed core.

### Windows: four silent failures, none of which said anything

All of these are invisible from POSIX.

- **A config file saved on Windows was read as no config at all** (#821): Notepad, `Set-Content`, and PowerShell 5.1's `Out-File -Encoding utf8` all write a UTF-8 BOM. Node's utf8 decode leaves the leading U+FEFF in place, so `JSON.parse` throws on character one — and this repo's config readers answer an exception with an empty config. `.mulmoterminal.json` lost its colors, badges, buttons, provider and model; `script.json` lost the Run menu; cwd presets vanished; `config.json` was judged corrupt, which the lenient loader turns into no providers, launchers, or header buttons. Nothing was ever displayed. The repo already had two workarounds for the same trap (SKILL.md frontmatter and wiki pages) — the rule was known and simply had not reached the JSON readers, so it now lives in `server/infra/read-text-file.ts`. Only a *leading* BOM is stripped; a U+FEFF in the middle is a zero-width no-break space, i.e. content. Genuinely broken JSON is still judged corrupt, which is what stops the app-config writer from overwriting a file you are editing.
- **Scheduled tasks and the translation cache had the same BOM trap** and now go through the same reader.
- **DOS device names reached the file routes** (#821): Windows resolves `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` in *every* directory, so `C:\anything\NUL` is the null device, not a missing file — containment answered "inside the base" and the open hit a device. `NUL` read empty; **`CON` blocked until console input arrived, hanging the request**. Extensions do not help (`CON.txt` is still CON), nor do trailing dots or spaces. The guard sits in `resolveContained`, the gate both file entry points already share, so one route cannot be fixed without the other. Windows only — `con` is an ordinary filename on POSIX. Matching is per segment, on both separators, case-insensitive, and lets `console.ts` / `nullable.ts` / `com10.txt` through.
- **Cleanup deletion threw on a locked file** (#821): `rmSync(..., { force: true })` only swallows "it wasn't there"; on Windows a file another process holds open fails with EPERM/EBUSY. Every one of these six call sites is cleanup — the work they belong to has already finished or failed — so an exception only turns a transient lock into broken housekeeping: `reap` stopping partway while an exiting claude still holds a settings file, boot giving up on installing skills. They all go through `server/infra/fs-cleanup.ts` now and report failure as a return value.
- **Two CRLF line-splitting bugs** (#820): "split external text into lines" was written as `split("\n")` in about 20 places; under CRLF each line keeps a trailing `\r`, poisoning whatever that rule feeds. `parseNumstatLine` produced diff paths like `src/a.ts\r`, so the client requested a diff for a path that does not exist and got nothing; `parseTmuxEnvironment` left an invisible character on every env value. Both moved to a new `server/infra/split-lines.ts`. Four more sites were verified safe by their own `trim`/`JSON.parse` and now carry CRLF cases so that safety cannot be removed silently; the rest were deliberately left rather than mass-rewritten.

### Windows: the spawn paths that had never been tested there

- **The Run menu / launcher PowerShell path** (`powershell.exe -NoLogo -Command`) had only pure argv-shape tests and had never actually been spawned on Windows; it now has 9 real-PTY cases covering quoted JSON, metacharacters, exit codes, and cwd (#820).
- **The codex argv path had no coverage at all**, which matters because `buildCodexArgs` deliberately embeds double quotes for TOML (`-c key="value"`) — if they are lost the value stops being a string. It now round-trips through the `.cmd` shim. The comment in `codex-args.ts` claiming "no shell is involved" stopped being true when #801 put codex behind a `.cmd`, and is corrected.
- **Adversarial argument content**: one spawn passing 20 arguments with the whole argv compared, so a dropped, split, joined, or reordered argument is caught. Leading/trailing whitespace and tabs, embedded quotes, `""`, `^ ( ) [ ] { }`, `& | < >`, `; , =`, `!`, `$` and backticks, runs of backslashes including trailing ones, Japanese, emoji (surrogate pairs), accents. The empty-string argument is its own case, since dropping it shifts every later flag onto the wrong value. `%VAR%` is deliberately excluded as a known cmd limitation pinned elsewhere. All green on real Windows; the one failure was a wrong assumption in the test itself (a PowerShell backtick escapes only inside double quotes), now recorded as both behaviors.

### Internals

- **Duplicate code reduced — `server/` and `src/` now share via `common/`** (#826, #827): jscpd's 4 duplicate-code alerts led to the real pattern behind them: values and wire types hand-mirrored between the two sides, even though `common/` is included by **both** tsconfigs and already carried `dirChrome` / `themeColors` / `modelPresets`. The mirroring was self-perpetuating — `firebase.ts` and `firebaseConfig.ts` each carried a comment claiming the server tsconfig cannot reach a shared module, which has not been true since `common/` existed. `firebaseConfig`, `Shortcut`/`ShortcutKind`/`sameShortcut`, `GitStatus`, `LaunchProviderOption`/`LaunchOptions`, the `GhItem`/`PrItem`/`IssueItem` family, and `EMPTY_DIR_CHROME` each have one definition now. `TEXT_EXTS` and `IN_APP_EXTENSIONS` share 45 entries but answer different questions, so only the intersection moved to `SOURCE_CODE_EXTENSIONS` and each side keeps its extras — both resulting sets are byte-identical to before, and `test/common/sourceExtensions.spec.ts` pins the deliberate asymmetries (`.md` routes to the rendered viewer, `.txt` opens in Files, dotfiles are server-only) so the next reader cannot "fix" them into symmetry. `AppRouteDeps` and `HookDeps` restated the same 7 callbacks and now extend one `SessionActivityDeps`; `TerminalCell` reuses the existing `CellChromeButtons` while keeping its own confirming close. Behaviour-preserving throughout, `-344 / +98` lines.
- **Every spec is type-checked now** (#826): `tsconfig.test.json` and `tsconfig.test-server.json` had been missing `test/scripts/**` and `test/*.ts` all along.
- **`CLAUDE.md` and `README.md`** record the `common/` rule that the mirrored copies violated, so the next shared value lands in the right place.

### Dependencies

- `@mulmoclaude/core` 1.3.0 → 1.5.0, `collection-plugin` 1.0.2 → 1.1.1, `google-plugin` 1.0.2 → 1.2.0, `mulmoscript-plugin` 1.1.1 → 1.1.2, `accounting-plugin` / `chart-plugin` / `html-plugin` / `markdown-plugin` → 1.0.3, `form-plugin` 1.0.1 → 1.0.2, `x-plugin` 1.0.0 → 1.0.1, `@mulmobridge/web-push` 1.0.0 → 1.0.1, `@receptron/task-scheduler` 1.0.0 → 1.0.1 (#824).

## mulmoterminal@1.11.1 — 2026-07-26

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.11.1.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.11.1.html))

### Windows

- **A session on an npm-installed Claude Code starts again** (#813, #814): the `--settings` JSON arrived at `claude` with nearly every quote gone — `Error: Settings file not found: {"hooks:{UserPromptSubmit:[{hooks:[{type:command,command:curl` — and the session exited immediately. `--settings` and `--mcp-config` are now written to a file and only the *path* is passed, so nothing claude is launched with contains a quote at all. There is a test asserting exactly that over the argv a real spawn builds. POSIX is untouched and stays inline.

  The diagnosis is worth recording, because the first attempt at it was wrong. The escaping added in 1.9.2 (#801) emits cmd.exe's own `""` doubling, and that is delivered intact — a test now asserts the **raw command line** the shim receives, and it still holds `""hooks""` and `-d @- >/dev/null 2>&1` unaltered. So neither `cmd-escape.ts` nor cmd.exe was corrupting anything. What drops the quotes is the **receiving program**: `""` inside a quoted argument means one literal quote to the Microsoft CRT, and Claude Code's `claude.exe` is a native binary that does not implement that extension. The reporter's own data said so from the start — `\"` worked and `""` did not, in the same shell against the same binary.

  The CI test that had passed was itself the reason this took two rounds: it read the *parsed argv* of its child, and its child was `node.exe` — the most forgiving argv parser on Windows. The one assumption it never checked was its own stand-in for the real target. It now asserts what cmd delivers rather than what node forgives, and carries a shim of both shapes `cmd-shim` generates. Diagnosis credit to @chikara813, who posted the shim's contents and read `cmd-shim`'s source rather than assuming a version difference.

  The escaping rule itself is still wrong for a non-MSVC target and is tracked in #819; after this change the only argument that can carry a quote in a normal spawn is a background chat's initial prompt.

### Tests, docs & dependencies

- **A Windows CI flake removed** (#816, #817): `streamFile.spec.ts` waited 20 ms for real file I/O and asserted an empty buffer when a loaded runner took longer. It now waits for the stream outcome itself, which also catches a request whose bytes arrive but whose response never ends. Test-only change.
- **`CLAUDE.md`** (#815): the repo's agent-facing conventions, in the file an agent reads first.
- `@codemirror/state` 6.7.1, `@codemirror/lang-markdown` 6.5.1 (#818).

## mulmoterminal@1.11.0 — 2026-07-25

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.11.0.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.11.0.html))

### Clicking a file path in terminal output

Terminal output is full of file paths, and clicking one used to do the same thing whatever it was: serve the bytes. A `.md` opened as markdown source, a `.csv` as a wall of commas, a `.ts` as text. Each kind now opens as the thing it is (#808).

- **Markdown renders** (#809): the "another model" help had always said a key belongs in a `.env` — and the Files overlay had always previewed markdown properly — but a clicked `.md` went to the raw route, which serves it as `text/plain`. It now goes to the route the overlay uses. The rendered page also stopped being hardcoded light: it opens in its own tab under a sandbox CSP and so cannot ask the app which theme is on, so it follows the reader's system setting instead of flashing white.
- **JSON is indented, CSV/TSV become a table** (#810): Chrome and Safari show a raw JSON file as one long line. A delimited file becomes a real table with a sticky header that scrolls inside its own box, so a wide one never pushes the page sideways. The CSV parser is written out rather than pulled in — the RFC 4180 rules are small enough to state exactly, and a loose parser silently splits a field in half, which is a wrong table nobody notices. Its output was cross-checked against Python's `csv.reader`, including the case where a quote preceded by spaces does *not* open a quoted field; that agreement is pinned as a test. Unparseable JSON and an unterminated quote both show what the file actually holds rather than an error, since that is exactly when someone opens the viewer.
- **Source opens in the Files view** (#811): a browser tab can only show source as bytes, and the app already highlights and edits it. A clicked `.ts` / `.py` / `.sh` / `.yaml` (about forty extensions) now opens in the Files view instead of a tab — no new dependency, since the highlighting is the editor's own. The alternative was a server-side highlighter, which the sandbox CSP forces, and that means a package for something the app can already do. Highlighting today covers the JS/TS family, JSON and Markdown — the modes `cmEditor.ts` bundles; other languages open as plain text.
- **`/files` gained `?path=`**: the file being edited now rides the URL like the project root already did, so a Files view is linkable and survives a reload.

Images, PDFs, SVGs and HTML keep opening in a tab — the browser renders those better than an editor would.

### Path containment

- **One gate for both file entry points**: the raw route and the browse routes had written the same containment out separately and drifted — the raw one expanded a leading `~`, the browse ones did not. It never mattered while every clicked path went to the raw route; sending source files to the browse routes made it reachable, so a line printing `~/proj/src/main.ts` would have opened onto a 403. `resolveContained()` in `files/pathContainment.ts` is now that gate, and both call it. Containment itself is unchanged: a tilde expanding outside the base is still refused, as are `..`, an absolute path, and a symlink leaving the base.

## mulmoterminal@1.10.0 — 2026-07-25

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.10.0.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.10.0.html))

### Configuration

- **`npx mulmoterminal` now reads the `.env` in the directory you run it from** (#795, #806): the "Running a session on another model" help says a key belongs "in the shell that starts MulmoTerminal, or a `.env` beside it". That was true of a dev launch and false of every real one — `yarn server` passes `--env-file-if-exists`, the npx launcher never did, so a key written into `.env` never reached the server and the provider stayed unusable with nothing to explain why. The launcher now passes the flag with an **absolute** path: its spawn runs with `cwd` set to the package directory, where a relative `.env` would be looked for inside `node_modules` and quietly not found. The file is read from where the command was typed, not from the workspace — the two are the same directory unless `--cwd` says otherwise, and there the shell's directory is what the help promises and what the user can see.

  Two behaviours were measured rather than assumed, since both decide what a key ends up being, and both are pinned as tests that spawn the real `node`: a name already set in your shell is **not** overridden by `.env`, and with several `--env-file` flags the last one wins. Note that `.env` values reach the `claude` / `codex` sessions too, since a session inherits the server's environment — already true of a dev launch, now stated in the README instead of left to be discovered.

### Windows

- **One path-containment rule, and the three callers it was broken in** (#802, #803): `target === base || target.startsWith(base + path.sep)` was hand-rolled in eight places, plus a ninth doing the same job with `===`. Six were safe only by construction — the target is derived from the base with `path.resolve(base, rel)`, so the prefix is the same bytes — and every place where the two sides came from *different* sources was wrong on Windows. `worktreeTask` resolved the cwd but not the root, so `C:\home\u\…` was compared against an unresolved `\home\u\…` and never matched (this was the daily Windows job's standing failure). `authorizedServingBase` compared a browser-supplied directory against stored session cwds with `===`, so a differently-cased spelling of one directory refused raw file serving. `isManagedWorkspace` did the same against `os.homedir()`, so a differently-cased workspace silently skipped preset/help seeding.

  `server/infra/path-within.ts` now owns the rule — both sides resolved, case folded on win32 only (a case-sensitive APFS volume is a supported setup, and widening a containment guard on a guess is the wrong direction), and the separator boundary kept so `…/project-old` is not inside `…/project`. `platform` is a parameter, so both arms are checkable from any host: `path.resolve` is itself platform-dependent, which is what broke. `isManagedWorktree` keeps its deliberate asymmetry through `isStrictlyWithin` — the worktrees root holds worktrees but is not one, so a delete aimed at the root must not pass.

- **The Windows CI job is green for the first time**: with the above fixed and the `fs.watch` reload case skipped there (it passes on one Node version and fails on the other for the same commit, and a job that is red half the time hides the regressions it exists to catch), `windows-daily` passes on Node 22 and 24. A red run now means a real regression.

- **`docs/windows-gotchas.md`**: the traps this repo has actually hit, each with where the fix lives — `CreateProcessW` running PE images only, node-pty's exact-name PATH lookup and its empty error message, cmd.exe's second parse of the command line, `path.resolve` drive qualification, case folding, 8.3 short paths, and env-name casing. A test file already pointed at this document; it did not exist.

### Docs & dependencies

- **The terminal scrollback / selection FAQ entry was wrong** (#782, #805): it blamed a "renderer generation mismatch", which the investigation ruled out. The cause is that tmux owns the scrollback and splits by cell type — a shell cell keeps real history in the main buffer and can be drag-selected, while a Claude/Codex cell runs on the alternate screen with `history_size = 0` and redraws its own transcript, so its scrolled-off history cannot be drag-selected in **any** terminal (VS Code and iTerm included). The OSC 8 half of the entry was fixed in 1.9.1 and is dropped. The practical workaround — redirect long output to a file and open it in the browser viewer — is now written down.
- Dependency bumps (#807): `@mulmoclaude/*` plugins to 1.0.2 / core 1.3.0 / mulmoscript-plugin 1.1.1, `@mulmoclaude/x-plugin` and `@receptron/task-scheduler` and `@mulmobridge/web-push` to 1.0.0, `mulmocast` 2.9.2.

## mulmoterminal@1.9.2 — 2026-07-25

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.9.2.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.9.2.html))

### Windows

- **npm-global installs spawn too** (#798, #801): 1.9.1 fixed the Claude Code installer's shape (`claude.exe` on PATH). This covers the other one — `npm i -g` leaves only `claude` (a shell shim), `claude.cmd` and `claude.ps1`, with no `.exe` at all. `CreateProcessW`, which node-pty ultimately calls, runs PE images only, so both variants of that install failed: the `.cmd` alone never satisfies node-pty's existence gate (`File not found: `, empty), and with the extensionless shim the gate passes but `CreateProcess` then looks for a `claude.exe` that isn't there (`Cannot create process`). A batch target now runs under `cmd.exe /d /s /c`, decided in the same single place as 1.9.1's fix, so `claude`, `codex`, `tmux` and the launcher all inherit it. Setting `CLAUDE_BIN` to an explicit `.cmd` path — the workaround #794 documented — is wrapped as well.

  Two things are deliberate here. `.exe`/`.com` still wins across the **whole** PATH before any `.cmd` is considered, rather than cmd.exe's per-directory order: an install whose shim sits in an earlier directory than its real `.exe` runs the `.exe` today and must not silently gain a parsing layer. And the argument escaping is cmd's, not the CRT's — `\"` does not escape a quote for cmd, it *ends* the quoted run and hands the rest of the argument to the parser, which is the injection this has to prevent. Every argument is quoted, internal quotes doubled, a trailing backslash run doubled, and NUL/CR/LF rejected outright rather than mangled. `%VAR%` expansion remains (cmd has no escape for it inside quotes) and is pinned as a test; rejecting every argument containing a percent sign would break ordinary prompts, and substituting our own child's environment into its own argument is a correctness wart rather than a privilege boundary. Rust hit the same wall in CVE-2024-24576, and Node answered CVE-2024-27980 by refusing to spawn `.cmd` without a shell at all.

  The escaping is verified empirically, not on paper: the Windows CI job builds a shim shaped like npm's (`node "…cli.js" %*`) and asserts the child's `process.argv` matches what was passed — JSON payloads (the real `--settings` / `--mcp-config` shape), `& | > ^ ( )`, embedded quotes, a trailing backslash, CJK, `50% done` — plus exit-code propagation through the extra cmd.exe process. Off Windows the resolution is inert: the same name, the same argv array, and no filesystem probe at all, pinned by its own test.

## mulmoterminal@1.9.1 — 2026-07-25

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.9.1.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.9.1.html))

### Windows

- **Sessions start on Windows again** (#794, #799): every `claude` session failed with `File not found:` — nothing after the colon — while Codex sessions on the same host worked. node-pty gates each Windows spawn on its own PATH lookup (`src/win/path_util.cc`, `get_shell_path`), which compares file names **exactly** and never appends an executable extension, so a bare `claude` misses the `…\.local\bin\claude.exe` that the official installer produces and the failing path is the empty string. The name is now resolved to an absolute `.exe`/`.com` inside `spawnPty()` — the one function every PTY spawn goes through — so `claude`, `codex`, `tmux` (which has no `*_BIN` override of its own, and needed an extensionless copy of `tmux.exe` as a workaround) and `powershell.exe` are all covered at once. Only PE images are ever substituted: node-pty launches through `CreateProcessW`, which cannot run a `.cmd`, a `.bat` or an extensionless shell shim, so resolving to one would break the spawns that work today — that is exactly why Codex worked, its extensionless shim satisfied the gate while a `codex.exe` elsewhere on PATH was what actually ran. When nothing resolves, the bare name is passed through unchanged, so hosts that work today are untouched. The rule is covered by 16 pure tests on every OS, and the Windows runner now spawns a real PTY from a bare name and pins the upstream node-pty behaviour so a future fix there is noticed. npm-global installs that ship only a `.cmd` still need a `cmd.exe` wrapper and are tracked in #798.

### Terminal

- **OSC 8 hyperlinks are clickable again** (#783, #785): links in terminal output — Claude's statusline `PR #NNNN`, for one — did nothing when clicked. The cause was not the front end: **tmux was stripping OSC 8**, since it only forwards advanced sequences when the outer terminal is declared to support them (the same shape as the existing OSC 52 `Ms` override). `set -as terminal-features '*:hyperlinks'` is now written into our isolated tmux config and applied live to an already-running server. The browser side gained an xterm `linkHandler` that opens `http(s)` links directly instead of raising a `confirm` dialog.
- **Source and text files open in the browser instead of downloading** (#785): the raw-file route now serves `.md`, `.ts`, `.js` and friends as `text/plain`, so a file link from the terminal previews inline. Images, PDFs and media are unchanged, and unknown extensions still download.
- **Developer notes for the terminal stack** (#785): `docs/terminal-notes.md` records the xterm/addon version constraints, which behaviours come from which setting (with the issue that introduced them), the tmux passthrough rule, and a regression checklist to walk before an xterm upgrade.

### Support & docs

- **A bundled `/mulmoterminal-bug-report` skill** (#793, #797): its goal is to get the user unstuck, not to file issues. It hears out the symptom one question at a time, checks whether the behaviour is configuration or by design by **reading the real config, schema and version** rather than guessing, searches existing issues (a fixed-but-outdated version ends in an update instead of a report), and only then collects the environment — keys masked, full preview and consent before posting. Its `faq.md` is an index that deliberately stores no values, only config keys and source paths, and CI verifies every entry still points at a key and a file that exist.
- **npx cache corruption troubleshooting** (#735, #796): the `ERR_MODULE_NOT_FOUND` startup failure caused by an interrupted first `npx` install is now documented in the README and the docs landing page, so it is reachable by search rather than only from the changelog and the launcher's own hint.

### Dependencies

- `concurrently` 10.0.3 → 10.0.4, `eslint` 10.7.0 → 10.8.0 (#800).

## mulmoterminal@1.9.0 — 2026-07-25

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.9.0.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.9.0.html))

### Phone / remote host

- **`getTerminalScreen` now carries the session's identity** (#786, #789): the response ships `cwd`, `branch`, `summary` (the AI header title) and `prompt` (the last meaningful user prompt) beside `screen` and `suggestion`, so the phone's per-session view (receptron/mulmoserver#107) can head the terminal with what the grid cell shows. Every field is optional and a value the host cannot answer is omitted key and all — the response is written to a Firestore command doc, which rejects `undefined`, and a blank labelled row on the phone would read as "no branch" rather than "not known". The metadata read runs concurrently with the screen capture (the branch lookup shells out to git), and a failure there costs the metadata, never the screen. A session that outlived a host restart has no PTY left, so it sends the screen alone, exactly as before.

### Grid cells

- **The expand ⤢ and close ✕ buttons look the same in every cell again** (#787, #788): in the launcher and command cells they rendered as browser-default buttons — a grey box with a rounded border, stretched vertically — while the Claude cell's were flat icon buttons and the ◀ ▶ beside them were fine. The cause was neither CSS nor the theme: `CellChromeButtons` renders a fragment root (two `<button>`s) and had no `<style>` of its own, so it carried no scope id at all — Vue hands the parent's scope id to a single root element only — and the shared, scoped `.cell-btn` / `.cell-close` rules matched nothing.
- **The shared cell chrome is now Tailwind utilities** (#791, #792): `cellChromeBase.css`, `cellChrome.css` and `CommandCell`'s own scoped block are deleted; their declarations live as utility strings in `cellChromeClasses.ts`, applied on the elements, so styling reaches a fragment-root component by construction. The `cell-*` class names stay as state and query hooks, carrying no styling. The status dot's pulse — the one thing a utility cannot express — moved into the Tailwind theme as `animate-cell-pulse`. Equivalence was verified by rendering every converted element twice, once with the deleted CSS and once with the new utilities, and diffing `getComputedStyle`: identical apart from an invisible border colour, `rounded-full` vs `50%` on a square dot, and the intended keyframes rename.

### Docs & dependencies

- **Why the canvas renderer is there, in the source** (#790): the `@xterm/addon-canvas` load site now records why it was introduced (the DOM renderer's CJK glyph metrics drift long Japanese lines off the right edge) and the trap that comes with it — the addon is an xterm-5 peer while the app runs `@xterm/xterm@6`, the prime suspect behind the selection-autoscroll / scrollbar (#782) and OSC 8 link-click (#783) regressions. Comments only; no behaviour change.
- **Deduplicated `@mulmoclaude/core`** (#784): `@mulmoclaude/mulmoscript-plugin` 1.1.0 requires core `^1.2.0`, which installed as a nested duplicate beside the root's 1.0.1. The root now takes `^1.2.0` and the lockfile is deduped so a single copy is hoisted — core carries backend service singletons and a native duckdb binding, where a duplicate is not harmless.
- `docs/styling.md` gained two gotchas learned here: a fragment-root component gets no scope id (so scoped CSS silently misses it), and two utilities for one property on one element are resolved by Tailwind's output order — compose one complete string per state instead.

## mulmoterminal@1.8.0 — 2026-07-25

### Terminal input & keyboard

- **Configurable submit / newline byte mapping** (#772): whether Enter *submits* or inserts a *newline* is decided by Claude Code from the received bytes, and that mapping is environment-dependent. A new global `terminalSubmit` setting (`"cr"` default, or `"esc-cr"`) selects which byte submits. It is honored across the browser keyboard, the phone remote-view submit, and GUI-originated sends (header `run:"input"`, skill invocation, the worktree commit prompt), and is scoped to **Claude sessions only** — shell/codex/command cells always submit with a plain `\r`, since `ESC+CR` is Alt+Enter to a shell. IME candidate-confirm Enter is never intercepted. The default `"cr"` is byte-for-byte the previous behavior. Documented in the [Configuration guide](https://receptron.github.io/mulmoterminal/guide/en/config.html#terminal-submit).
- **Clickable file paths in terminal output** (#778): file paths in output are linkified and open a browser preview via the raw-file route, scoped to the session's live cwd (`?cwd=` constrained to live session dirs).
- **Larger scrollback after reattach** (#776): the PTY replay buffer was raised (64 KiB → 1 MiB) so roughly 1000 lines of scrollback survive a reconnect.

### Header & grid

- **Richer default header buttons** (#775): the built-in starter set now adds 📁 browse files, 🖥 new terminal here, 🔗 this branch's PR (git repos, only when a PR exists), and 🌐 open on GitHub — alongside the existing insert-path / reveal. Setting `buttons` at any level still replaces the whole default set; this is now spelled out in the docs.
- **Zoomed-grid view-toggle placement** (#769, #771, #774): when a cell is expanded, the view-toggle no longer covers the cell's ✕ or the Settings button — it moved into the global header and sits at the right end next to Settings.
- **User-guide help links** (#770): the empty grid and the settings modal now link into the user guide.

### Worklog

- **Worklog header shortcut** (#765): a `#worklog` shortcut added to the grid view's right-hand icon group.
- **Weekly worklog pages indexed** (#773): weekly worklog pages register in `index.md` with a `#worklog` tag, so each page appears under the worklog filter.

### Fixes & docs

- **Phone terminal view lists grid sessions only** (#767).
- **Dev-server watch test flake on Windows** (#777): resolved an `fs.watch` flake by re-touching until restart.
- **Cross-repo PR/Issue view guide** (#763): new ja/en guide page.

## mulmoterminal@1.7.2 — 2026-07-24

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.7.2.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.7.2.html))

A hardening release: a repo-wide code review turned up a family of real bugs across the server, the plugin runtime, the remote-host (phone) channel, and the git/worktree tooling. Each fix ships with a regression test.

### Server / backend

- **git worker deadlock & encoding** (#754, #743): `git()` never drained stderr, so a chatty `git worktree add` (git-lfs smudge errors filling the 64 KB pipe) deadlocked and wedged the worktree-create queue; stderr is now drained. Process output is decoded once so a multibyte UTF-8 character split across pipe chunks isn't corrupted (Japanese PR titles / branches / commit messages), and worktree diffs pass `-c core.quotePath=false` so non-ASCII paths read as themselves instead of octal escapes.
- **stream & external-call error/timeout gaps** (#755, #744): `GET /api/files/raw` and the `/artifacts/html` preview piped a read stream with no `error` handler, so a file that vanished or turned unreadable between stat and open crashed with an uncaughtException and hung the request; both now return 500 (or abort cleanly). Gemini image generation gained an abort timeout.
- **plugin fetch** (#757, #745): `allowedHosts` compares on hostname (a `localhost` pin now accepts `localhost:8080`), a caller-supplied AbortSignal is honored, the timeout covers the response body (not just the headers), and a redirect can't land the plugin on a host outside its pin.
- **startup, tmux, and mutate** (#759, #747): the launcher's readiness poll no longer forks on timeout into duplicate banners / browser tabs; `tmux cleanup-orphans` spares a session another mulmoterminal process is attached to; and a mobile-view edit whose (thumbnail-inlined) response exceeds the byte budget is reported as applied rather than a 4xx that showed the edit as failed and kept stale data.

### Remote host (phone) channel (#760, #746)

- Staged uploads are deleted only after the chat spawns, so a spawn failure (e.g. a missing provider token) leaves them intact for a retry; `Content-Type` parameters (`text/plain; charset=utf-8`) now map to the right extension instead of `.bin`; a leading UTF-8 BOM no longer hides a `SKILL.md`; attachment filenames use a full UUID (no 32-bit birthday collision that `rename()` would silently overwrite); and expired-command cleanup keeps its never-throw contract when a doc has no params.

### Worktree tooling (#762, #748 follow-up)

- `git diff <base>` no longer errors ("ambiguous argument") when a file is named after the base branch; re-running "create PR" opens the existing PR instead of the compare page; and removing a worktree deletes its branch even when the given path isn't realpath-canonical.

### Bundle of minor fixes (#761, #748)

- Model-preset context-length typo (`512_288` → `524_288`) and user-model dedup; empty upstream errors no longer narrate as a bare "Done"; a transient `gh` failure isn't cached as "no PR" for the TTL; the shipped config JSON Schema no longer requires all ~23 palette keys (a single-color write validates); plugin dispatch goes through a `Map` (a tool named `constructor`/`__proto__` 404s instead of resolving through the prototype chain); and a malformed/multi-range `Range` header is ignored (full 200) rather than answered 416.

### Other

- **npx cache recovery hint** (#736, #735): an npx install aborted mid-unpack leaves a half-unpacked cache entry that crashes the backend at boot with `ERR_MODULE_NOT_FOUND`; the launcher now detects that and prints an OS-appropriate, shell-quoted removal command so the fix is one copy-paste away.
- **dev backend auto-restart on crash** (#734): the dev supervisor restarts the backend on any crash so tmux-backed terminals self-heal, and watches `common/` and `bin/` (not just `server/`) for reload.
- **file drop no longer navigates away** (#752, #750): dropping a file anywhere in the window no longer replaces the page with the file.

## mulmoterminal@1.7.1 — 2026-07-24

> 📘 **[Setup guide for this release](https://receptron.github.io/mulmoterminal/guide/en/v1.7.1.html)** — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v1.7.1.html))

A same-day patch undoing two 1.7.0 regressions and fixing a couple of terminal bugs.

### Regressions fixed

- **Grid resume picker lists all sessions again** (#758, reverts #724): 1.7.0 filtered the grid's empty-cell resume picker to grid-launched sessions only, so sessions started in the normal terminal / a plain `claude` disappeared from the grid picker. The picker again lists every session in the directory. (The chat sidebar's older behavior is unchanged.)
- **Wheel scrolls the terminal instead of spinning input history** (#738, #737): after the #729 mouse-tracking change, scrolling a zoomed terminal cycled the input history instead of scrolling the transcript. The wheel now scrolls; keyboard ↑/↓ still cycles history.

### Fixes

- **Corrupt `config.json` no longer wipes every setting** (#751, #741): if `config.json` was malformed, the next settings save discarded all existing settings; a corrupt file is now handled without data loss.
- **Codex session status tracking** (#753, #742): an interrupted turn could leave a codex cell stuck "working," and a deleted skill's mirror could linger.
- **tmux OSC 52 clipboard passthrough** (#749, #740): the tmux conf's double-quoting dropped `\E`, breaking clipboard copy from inside tmux.

### Docs

- **Animated hero GIF at the top of the README** (#756).

## mulmoterminal@1.7.0 — 2026-07-24

A resilience-and-cockpit release: one uncaught error can no longer take down every terminal, the cockpit roster gained reordering, shared directory-colored headers, auto-sort and proper scrolling, and the docs were audited end-to-end against the implementation — with the guide's highlights (roster, phone push, worktrees) now front and center.

### Reliability

- **One uncaught error no longer disconnects every terminal** (#732): the backend had no process-level `uncaughtException`/`unhandledRejection` guards and no `ws` socket error handler, so a single dropped client (`ECONNRESET`) could kill the whole server — every terminal's WebSocket died at once and, under `node --watch`, stayed dead. Process guards now log and survive, and a socket-error logger at the `handleUpgrade` choke point keeps one dropped client to one dropped client.
- **Terminal selection no longer sprays mouse-report noise** (#730, #729): selecting text in a cell whose program enabled mouse tracking could inject escape sequences into the input; selection now suppresses the reports.
- **Grid resume picker lists only grid-launched sessions** (#726, #724): externally started sessions (e.g. a dev terminal) no longer appear in an empty cell's resume list.

### Cockpit roster

- **Reorder rows from a ⋮ menu** (#708, #707): in manual sort mode each roster row gets a move-up/down menu.
- **One header for roster rows and strip thumbnails** (#711, #710): both render the shared `CockpitHeader`, so the directory's configured header color always applies.
- **Auto-sort reaches the roster** (#721, #720): the side list orders by attention the same way the grid does.
- **The roster scrolls instead of squishing** (#723, #722): many sessions now overflow into a vertical scroll rather than crushing rows.
- **`event` and `workPhase` on the session activity doc** (#728, #727): the activity doc now says whether a waiting session is blocked vs done, and whether a working one is planning vs editing — with a bounded tracker feeding the roster's status words.

### Tests & internals — #611 series

- **Decisions extracted from I/O and pinned by tests** (#712, #713, #714, #715, #716, #717, #718, #719): the Settings cost formatter, staged-attachment storage-id guard, terminal-input sanitize + clear-box gate, per-key TTL cache, remote attachment ingest ordering/failure safety, remote-host collection pagination, attachment path/naming rules, and the draft-vs-autorun decision are now pure, injected, and covered.

### Docs

- **Mobile push setup split by platform** (#731): the notifications guide now installs the PWA first on iPhone (an iOS 16.4+ requirement) and keeps the in-browser flow on Android; the README links both guide languages up top.
- **Full docs-vs-implementation audit** (#733): ~20 stale claims fixed — the 4-state status colors (amber is input-waiting only; a finished turn shows a blue ring), pushes fire even for the viewed pane and also on blocked turns, `cwdPresets` takes `{label, path}` objects, Run scripts launch in a spare cell, the 27 built-in provider models require `id: "openrouter"` — plus previously undocumented features (cockpit roster, PR-phase badges, ⇄ Exchange, model picker, in-app views) and new "Highlights" sections with real screenshots.

## mulmoterminal@1.6.0 — 2026-07-23

A large release: local models via Ollama, a provider/model picker when launching sessions, the first automatic cross-terminal review round, and update-awareness in the web header — plus a broad sweep of reliability fixes.

### Local models & backends

- **Run against a local Ollama model** (#692, #655): `claude-ollama` launches Claude Code against a local Ollama model, and a session can target it.
- **Pick a provider and model when launching** (#584, #579): choose the provider/model at launch, and run a directory's sessions on a chosen Anthropic-compatible backend.

### Codex sessions

- **Working / done straight from the rollout** (#582): a codex cell is flagged working and done by reading its rollout's turn boundaries.

### Cross-terminal review — #550 Phase 3

- **One automatic exchange between two terminals** (#595): hand a turn to a sibling terminal, wait for its answer, and relay it back — with a stop control, and without quoting the asker's own words back to them.

### Update awareness

- **Update-available badge in the web header** (#677): the header shows when a newer version exists; click it to see the exact update command.
- **git-clone users are told about updates too** (#654), not only npm installs.

### Terminal & grid

- **Ask before a second instance** (#653): starting a second instance now prompts instead of refusing.
- **Grid expand/collapse animations** (#682): every cell flips on expand/collapse (not just the zoomed one), filmstrip cells slide into place alongside the zoomed one, and each roster row shows a coloured status+dir header bar.

### Reliability

- **Stale out-of-order responses no longer overwrite live state** (#620 family, #673): a family of races where an in-flight GET's answer clobbered a newer live update — session feed, notifications, grid activity, the resume list, grid meta seeds, terminal usage badges, and the git-status chip — each fixed and pinned with a test.
- **Cross-process staleness in shared files** (#672, #705): two servers sharing one `~/.mulmoterminal` no longer drop each other's attention state, and a non-owning server re-reads a session's tool history instead of showing a stale copy until restart.
- **No orphan PTY on `/ws/run`** (#671): a viewer leaving during command resolution no longer leaks a shell process nobody reaps.
- **Preset models dedupe case-insensitively** (#674) so a differently-cased entry doesn't appear twice in the picker.

### Under the hood

Most of this release's ~119 merged PRs are internal refactors — an inventory that extracts I/O-buried decision rules into tested pure functions, and the completion of the `server/index.ts` split — and change no behaviour. They are deliberately not itemised.

## mulmoterminal@1.5.0 — 2026-07-22

Reading a terminal session from your phone landed in 1.4.0; this release makes it usable — you can type into a session, tap the agent's own suggestion, and get told when a session is *blocked* rather than only when it finishes.

### Your phone can drive a terminal session

- **Type into a live session** (#445, #446): send a line to any session attached on this host, framed as a bracketed paste with the Enter as a separate write so Claude's TUI doesn't drop it. Sends are chained per session, so two overlapping ones can't interleave into one merged command.
- **Send only what you typed on the phone** (#572, #573): a draft left in the input box on the host used to be submitted merged with the phone's text, with no separator — "yes I already typed this" + "ok" arrived as `yes I already typedthisok`. The box is cleared first now. Which key was measured, not assumed: Ctrl-U and Ctrl-A/Ctrl-K clear only the current *visual* row and leave a wrapped draft behind, Esc does nothing to it, and Ctrl-C empties it whole — riding in the same write as the paste, and a no-op on an already-empty box. The clear is withheld wherever the host can't vouch for the session: mid-turn Ctrl-C would interrupt the turn, in a shell it would kill whatever is running, and an absent activity record means "nobody has reported yet", not "idle".
- **Tap the agent's own suggestion** (#563, #565): Claude offers a follow-up prompt as dim ghost text you accept with Tab. Colour doesn't survive a capture, so on the phone it read as text already typed that nothing would send. The host now captures the pane *with* escapes, normalises it into rows carrying each row's dim run, and returns the suggestion beside the screen. A row qualifies only when everything past the caret is dim, so a real draft is never offered back.
- **The phone knows what each session is running** (#447): claude, codex or shell, so it can offer input that suits it instead of putting `ls` in front of an agent — and "unknown" stays distinguishable from "shell" rather than being guessed.
- **The screen follows the session** (#439, #442): the host publishes a revision to Firestore on every real transition, so the phone refreshes on its own instead of waiting to be asked.

### Notifications

- **Pushed when a session is blocked, not only when it finishes** (#472, #474): a permission prompt or a question is exactly the case where answering from your phone unblocks work, and you couldn't know about it otherwise.
- **A tap opens the session it came from** (#440, #443, #457): the push carries the session id *and* the host id, so it no longer lands on the host picker.
- **The body says what the agent did** (#549): the finished-turn push carries the reply itself — collapsed to one line, markdown flattened, links reduced to their text — instead of a generic "done".

### Hand a turn from one terminal to another

- **Pull another terminal's last turn into this cell** (#550, #566, #574, #576): take a sibling session's previous turn and continue it here, without a round trip through the clipboard.

### Reliability

- **Windows** (#478, #480, #485, #561): portable worktree / slug / temp handling, platform-agnostic dir-config write targets, and a Claude project-directory encoding that now matches upstream — that last one had been making `--resume` fail *silently*.
- **Scheduled runs no longer leak tmux sessions** (#541, #545): a scheduled session's tmux session is reaped along with it.
- **Sandbox spawns refresh the host Keychain token first** (#492, #494).
- **Launcher environment** (#449, #458): package-manager launcher env is sanitized before a PTY spawn, and PATH entries are matched on their last segment.
- **Theming**: command / launcher grid cells follow the app theme (#468), Settings warnings render red (#523), and global CSS sits in `@layer base` so utilities apply (#535).

### Under the hood

Most of this release's 115 merged PRs are internal and change no behaviour — the app's styling moved to Tailwind, `server/index.ts` was split into routed modules, and a long run of de-duplication landed. They are deliberately not itemised.

## mulmoterminal@1.4.0 — 2026-07-20

A phone can now view one of this host's terminal sessions, the cockpit roster gained workflow phases, and the output buffer no longer corrupts the screen restored on reattach.

### Features

- **View a terminal session from your phone** (#435, #436): two new remote-host handlers, `listTerminalSessions` and `getTerminalScreen`, let the mulmoserver PWA pick one of this host's sessions and read its current screen. Registering the handlers is enough to advertise the capability — presence derives it from the handler table — so no protocol change was needed. Screens come from `tmux capture-pane` where available (works while detached, survives a host restart) and fall back to rendering the session's buffered output through `@xterm/headless` for hosts without tmux, non-persistent spawns, and the race where a session ends mid-read. Both paths return plain text. The picker filters by the same resumable rule the orphan cleanup uses and drops sessions the host can no longer name unless they are live — the transcript-on-disk rule alone yielded 67 rows, 62 of them bare UUIDs, on the author's machine. Requires the companion UI, receptron/mulmoserver#71.
- **Workflow phases in the cockpit roster** (#428): the grid's zoom + list roster now shows where each agent's branch stands alongside its activity state.
  - **#429** — `server/git/prPhase.ts`: a pure `derivePrPhase` over `gh pr list` output (`none` / `draft` / `ci-failing` / `changes-requested` / `ci-running` / `ready` / `merged` / `closed`), a 30 s cache keyed by repo+branch, and `GET /api/pr-phase?cwd=`. No UI change.
  - **#430** — renders the phase beside each roster row, so a wall of parallel agents shows which are in review, waiting on merge, or merged.
  - **#431** — splits `working` into planning vs implementing from a pure `classifyWorkPhase(recentTools)`: mutation tools (Edit/Write/NotebookEdit) mean implementing, read/search-only means planning, Bash is neutral.

### Fixes

- **Output buffer truncation corrupted the restored screen** (#434): the 64 KiB tail was sliced by character count, so a cut could land inside an escape sequence and leave orphaned parameter bytes rendering as literal junk (`5;196m`) at the top of the screen restored on reattach. The shipped fix decides from the text that was *discarded* — it finds the last ESC before the cut and checks whether that sequence closed before it — rather than pattern-matching the retained side, which also matched ordinary text and silently corrupted it (`"5 files pending"` → `"iles pending"`, `"/api/v1/resource"` → `"pi/v1/resource"`). Two further bugs fell out of the rewrite: a clean cut now keeps every retained byte, where the earlier version resumed at the next newline or ESC and discarded the head of the tail even when nothing had been split; and a split OSC string is cut at BEL/ST rather than the first `0x40-0x7E` byte. The search for the opening escape spans the whole discarded prefix rather than a fixed window — this host enables OSC 52 deliberately (the `Ms` terminfo override forwards Claude Code's auto-copy to the browser clipboard), so kilobyte base64 payloads are a designed-for case and a 64-byte window lost the introducer, leaking base64 onto the screen.

### Chores

- **`@mulmoclaude/core` `^0.22.1` → `^0.23.1`** plus collection/google/mulmoscript plugin bumps (#432). A workspace-compatibility update rather than a routine one: a core older than 0.23 skips `dataSource` schemas at discovery, so CSV-backed collections created in MulmoClaude did not appear here at all.
- **`@mulmoclaude/core` `^0.23.1` → `^0.25.1`** and a port of record I/O onto the CollectionStore seam (#433). MulmoClaude can now create `storage: sqlite` collections whose records live in a single SQLite file rather than per-record JSON; the raw `readItem`/`writeItem`/`deleteItem` calls these backends used wrote to a phantom `dataDir`.
- **`@mulmoclaude/collection-plugin` `^0.13.2`** (#437): fixes outside-click dismiss for dropdown menus inside PluginFrame's shadow root, where `ref.contains(event.target)` is always false at document level because the event target is retargeted to the shadow host.

### Documentation

- **Screenshots in the README** (#438): seven images with end-user captions, taken from the Zenn guide. The README previously had no images at all.

## mulmoterminal@1.3.1 — 2026-07-18

### Chores

- **Dependency updates** (#427): `@mulmoclaude/collection-plugin` `^0.11.1` → `^0.12.0` (requires `@mulmoclaude/core@^0.23.0`, matching the current pin, so a single core copy still resolves), `@mulmoclaude/mulmoscript-plugin` `^0.2.1` → `^0.2.2`, and `@tailwindcss/vite` + `tailwindcss` `^4.3.2` → `^4.3.3`. No behavioural change.

## mulmoterminal@1.3.0 — 2026-07-18

Google integration matured end to end (OAuth + Calendar + broker, plus a Calendar extension for non-primary calendars and colours), dead-code / duplication detection added to CI, a symlink-escape hardening, and a large test-suite reorganization.

### Features

- **Google integration, end to end.** Link a Google account (local loopback OAuth, token shared with MulmoClaude) and drive Calendar from the chat `google` tool, the phone's `google.calendar.*` commands, and the mulmoserver broker: initial OAuth + Calendar + a PluginRuntime host for factory-style plugins (#389), host-neutral link guidance (#390), an npm two-copies fix so the published package resolves a single `@mulmoclaude/core` (#415), broker-based authentication (#421, tests #424).
- **Google Calendar extension — non-primary calendars + colours** (#426): `createEvent`/`listEvents` gain `calendarId` (default primary) + `colorId`, plus new `google.calendar.listCalendars` and `google.calendar.colors` commands, following `@mulmoclaude/core@0.23.0` / `@mulmoclaude/google-plugin@0.3.0`. **Existing links must re-authorize** (Settings → Google account → Unlink → Sign in, or `mulmoterminal google login`) for the new calendar-list / colour read scope; primary-calendar event read/create keeps working without re-linking.
- **jscpd copy/paste duplication detection** reported to Code Scanning (#405), later extended to also scan `.vue` files (#422).
- **knip cross-module dead-code detection** in CI (report-only) (#420).

### Fixes

- **FileOps symlink-escape hardening** (#416): the plugin containment guard now resolves symlinks (including dangling ones) so a planted symlink can't read/write outside a plugin's rooted dir.
- **Repaired broken imports in relocated test specs** (#418) that had turned main red.

### Refactors / Chores

- **Shared `THEME_COLOR_KEYS` across the server/client build boundary** via a new `common/` dir, shipped in the published package (#423).
- **Deduplicated the gh issue/PR normalizers** (#422) and added shared error-handling / spawn utilities (#409).
- **Test-suite reorganization**: moved every `*.spec.ts` from beside its source into a dedicated `test/` tree mirroring the source layout — bin, server/{config,agents,backends,files,git,session,infra}, src/{components,composables,router,utils} (#395, #396, #397, #398, #401, #402, #403, #404, #406, #410, #411, #412, #413, #414).
- **Housekeeping**: untracked accidentally-committed local config artifacts and gitignored them (#419); gitignore MCP / Playwright config (#393).

## mulmoterminal@1.2.0 — 2026-07-16

One-command first-run setup (`npx mulmoterminal init`), a bigger zoom hit-target in the grid, a server-directory reorg, and dependency updates.

### Features

- **`npx mulmoterminal init` — idempotent first-run setup** (#381): checks your environment (Node ≥ 22.9, the `claude` CLI, plus optional `tmux` / `gh` / `codex`), seeds the launcher's working-directory presets from the projects in your Claude Code history (reads each transcript's real `cwd`, keeps only dirs that still exist), and writes `~/.mulmoterminal/config.json` — preserving your other settings. Re-run any time; `--dry-run` previews without writing. When `claude` is installed it can hand off to the `/mulmoterminal-config` skill.
- **Zoom a grid cell by clicking its header background** (#378): a larger, easier hit target for zooming a cell in place; the grid also stays zoomed on a neighbour when the zoomed cell is closed (#376).

### Refactors

- **Server reorganized into role subdirectories** (#372, #373): `server/{config,agents,backends,files,git,infra,mcp,session,skills}/` — no behavior change.

### Chores

- **Dependency updates** (#370, #382): refreshed `@mulmoclaude/*` and other packages.
- **Docs / tidy**: the README now leads with the product's value proposition (#375); completed plan files moved to `plans/done/` (#371).

## mulmoterminal@1.1.0 — 2026-07-15

Grid launcher UX (a preset click fills the field and shows resumable sessions), a header Skill menu, reliable tmux teardown on explicit close with a safe orphan cleanup, and a session-summary caching perf win.

### Features

- **Preset dir click fills the field instead of launching** (#361, #362): clicking a directory preset chip in the grid launch form now fills the working-directory field and reveals the "or resume here" session list — so you can resume an existing session (or pick the agent / a worktree / a script) — instead of starting a fresh session immediately. A one-click quick-launch stays on the chip's ▶ button. (#362 also removes a redundant double-fetch of the resume / scripts / worktrees lists on fill.)
- **Header Skill menu** (#365): run a `.claude/skills` skill from a header menu, like the Run menu.

### Fixes

- **Explicit close now kills the tmux session** (#367): closing a cell with ✕ reliably kills its tmux session even when the socket is down or the session was orphaned by a prior server restart — the reap now goes over `POST /api/session/:id/terminate` instead of a socket-only message. Adds `POST /api/tmux/cleanup-orphans` that reaps only non-resumable orphan tmux sessions (never a live / grid / Claude-or-Codex-transcript-backed one); both routes are same-origin guarded. Fixes a tmux-session leak that had accumulated 126 sessions (cleared down to the resumable set on one run).

### Performance

- **Session transcript summary caching** (#369): cache the per-session summary and parse the transcript a single time, cutting redundant re-parsing.

## mulmoterminal@1.0.0 — 2026-07-14

First stable release. Web Push to your phone is now solid end-to-end — it fires for every finished turn (not just background ones), self-heals its RemoteHost connection after a server restart, and shares its send core with MulmoClaude — plus an opt-in cross-clone dev worklog.

### Features

- **Web Push fires on every finished turn** (#357): a push now lands even for the session you're actively viewing, not just background ones. The attention beep keeps its active-pane suppression (you're already looking at it); only the push ignores it.
- **Self-healing RemoteHost session** (#359): after a server restart (dev `--watch`, crash, redeploy) the browser silently re-pushes its parked session on socket reconnect / tab refocus / network restore, so Web Push no longer dies while the UI still shows "connected" — with no manual reload. Previously the re-push only ran on page load.
- **Cross-clone dev worklog** (#352): an opt-in built-in system task (`worklogEnabled: true`, default OFF) periodically summarizes what you built — across every clone of a repo, organized per repository, including decisions discussed-but-not-implemented — into browsable wiki pages, built on the shared scheduler and wiki. The aggregation window is `[lastRunAt, now]`, so nothing is dropped when the machine sleeps past the interval.

### Refactors

- **Shared Web Push send core** (#355): the `sendPush` wire contract now lives in the shared `@mulmobridge/web-push` package (auth injected, no firebase dependency), so MulmoClaude and MulmoTerminal can't drift when mulmoserver changes the contract. Pure refactor — no behavior change.

### Docs

- **Mobile Web Push setup guide** (#350): a new guide page (Japanese + English) covering the terminal side (RemoteHost Connect + the "Notify my devices when a task finishes" toggle) and the phone side (the mulmoserver PWA — same Google account, enable notifications, add to home screen).
- **Dev worklog how-to** (#353): documents enabling (`worklogEnabled: true` in `~/.mulmoterminal/config.json`) and viewing (the "作業ログ 一覧" hub page or the `#worklog` wiki tag).

## mulmoterminal@0.9.3 — 2026-07-14

RemoteHost login now survives a server restart (the session is parked in the browser), which also keeps Web Push working across restarts; plus a fix for the Web Push toggle in the grid view.

### Features

- **RemoteHost login survives a server restart** (#346): the RemoteHost Firebase session is parked in the browser (localStorage) and restored on reconnect, so restarting the server no longer forces a Google re-login — the client silently reconnects from the parked session (case A' of receptron/mulmoserver#50, via `@mulmoclaude/core@0.13.0`'s export/seed-able session controller). This also keeps Web Push working across restarts, since push needs the RemoteHost connection for its notification auth.

### Fixes

- **Web Push toggle wasn't saved in the grid view** (#348): the grid view renders its own Settings modal, which was never wired for the "Notify my devices when a task finishes" toggle — so in the grid it showed unchecked and didn't persist. It now reflects and saves the setting like the single view does.

### Chores

- **Tidy** (#349): moved completed plan files to `plans/done/`.

## mulmoterminal@0.9.2 — 2026-07-13

Web Push notifications when a background task finishes, a native folder picker for launcher working directories, and a set of correctness fixes: cross-instance config safety, attention state restored across a restart, and grid rendering.

### Features

- **Web Push on task completion** (#339, #340): a background session sends a Web Push notification when its task finishes, so you're pulled back even when you're not watching the tab. Hidden/internal worker sessions are excluded from the push.
- **Pick the working directory via an OS dialog** (#334, #335): a cell launcher can choose its working directory through a native folder picker instead of typing the path.

### Fixes

- **Config no longer clobbered across instances** (#337, #338): `POST /api/config` now read-modify-writes `~/.mulmoterminal/config.json`. With several mulmoterminal instances sharing that file, saving settings in one instance could previously overwrite header buttons/chips another instance had written; the save now merges onto the current on-disk config so those edits survive.
- **Attention state restored across a restart** (#342, #343): working / waiting activity is restored on boot so grid cells don't drop to idle after a server restart.
- **Grid cells no longer blank on reattach** (#344, #345): the terminal repaints on reattach / reactivation, fixing blank cells when returning to a grid.
- **Grid focus-zoom clipping** (#331, #332): the focus-zoomed cell is kept on screen so edge characters aren't clipped.

### Chores

- **Tidy** (#333): moved completed plan files to `plans/done/`.

## mulmoterminal@0.9.1 — 2026-07-12

Grid-view release: configurable header action buttons, a text roster ("cockpit") beside the expanded terminal that always summarizes on our side, and attention-signal correctness fixes for off-page and post-restart cells.

### Features

- **Configurable header action buttons** (#319 via #320/#323/#324): the terminal header's action buttons are now config-driven with sensible defaults — a **file-path picker** plus **"reveal in the OS file manager"**, a **"new terminal"** button that opens a `$SHELL` cell adjacent to the current one, and an **"open PR"** button shown only when the current branch has an open pull request.
- **Grid cockpit — text roster** (#325): beside an expanded grid terminal, a dense text roster lists every session — directory, AI summary, current prompt, latest reply, and a word status (running / waiting / done / idle). Click a row to switch which terminal is enlarged; toggle between the list and the old thumbnail strip.
- **Roster self-titling / fresh summaries** (#327): the grid roster now always summarizes on MulmoTerminal's side rather than surfacing a stale externally-written title, regenerating the summary from the current transcript for sessions it didn't launch (unmanaged, resumed, or after a server restart), gated by in-flight and retry-backoff guards.

### Fixes

- **Grid attention signal reaches on-screen cells** (#322, #321): the "waiting for input" attention signal is now surfaced for cells currently on screen in the grid.
- **Off-page and post-restart attention state** (#329, #321): off-page grid-cell attention is routed through `/api/activity`, and blocked/done attention state now persists across a server restart.

### Chores

- **Tidy** (#328): moved the completed plan file to `plans/done/`.

## mulmoterminal@0.9.0 — 2026-07-12

Grid-view–focused release: smoother top-tab navigation (the grid is kept mounted, flicker-free), clearer active-cell feedback, AI-summarized cell-header titles, and live theming — plus several correctness fixes, a config-authoring skill, and docs.

### Features

- **Persist the grid across top-tab switches, flicker-free** (#318): switching top tabs and returning no longer rebuilds the grid. It's kept mounted (`<KeepAlive>`), so you come back to the exact same state — same cells, same zoom, even a half-typed command line — with no re-render, re-fetch, or re-fit. The cell that last held the cursor regains focus automatically, and per-directory palettes are seeded from cache so a returning cell never flashes the default theme for a frame. (Terminal connections already persisted; this removes the visual churn on top.)
- **AI-summarized title in the cell header** (#317, #316): once a session becomes a back-and-forth, the raw last prompt is a poor label. Recent turns are now summarized by a cheap model (Haiku, overridable via `MT_TITLE_MODEL`) into a short AI title shown in the cell header and the session list, falling back to the last prompt when no title exists yet.
- **Zoom the active grid cell in place on focus** (#310): the keyboard-focused terminal lifts and grows slightly, in place, so the active cell is obvious at a glance — via a CSS `transform: scale` that keeps text crisp and never changes the cell's layout box, so xterm is never refit and the PTY is never resized as focus moves between cells.
- **Zoom the new cell when adding a terminal while zoomed** (#313): pressing "+ Terminal" while a cell is expanded promotes the new cell into the enlarged view, so you configure and launch it where you're already looking instead of hunting for it in the filmstrip.
- **Animated expand/restore (FLIP)** (#298): zooming a grid cell animates from its grid slot to the enlarged view (and back) with a transform-only FLIP, so xterm refits once rather than every frame. Honors `prefers-reduced-motion`.
- **Live-reload `.mulmoterminal.json` — no filesystem watchers** (#303): editing a directory's `.mulmoterminal.json` recolors its terminals immediately, with no page reload, no server restart, and not a single fs watcher — the server already observes every write via Claude's `PostToolUse` hook, so the writer announces the change and nothing polls.
- **`mulmoterminal-config` skill (zod-backed)** (#297): a new `/mulmoterminal-config` skill authors a valid `.mulmoterminal.json` from a short conversation — for the current directory or a batch of recent directories — so nobody hand-writes the color/DSL config. The DSL is now defined once in zod (`z.infer` types + runtime validation + a shipped JSON Schema); the skill installs into the global Claude and Codex skill roots on boot and is launchable from a new toolbar button.

### Fixes

- **Canvas renderer stops CJK drift** (#315): long Japanese lines drifted past the terminal's right edge (English wrapped fine). xterm now uses the canvas renderer, drawing every glyph in its own fixed-grid cell, so per-glyph advance-width mismatch (common once JetBrains Mono is installed and the OS CJK fallback's width differs) can no longer accumulate.
- **Resume on-disk sessions even when a tmux session is alive** (#305): opening a past session could fail with `Session ID … is already in use` — claude's own error when `--session-id` is used for an id that already has an on-disk transcript. The server now always uses `--resume` for on-disk transcripts regardless of tmux liveness, so a tmux session that died between the check and the spawn (a reap, an `/exit`, or another instance on the shared tmux server) no longer aborts the launch.
- **Refocus the grid terminal after expand/collapse** (#312): expanding (⤢) or restoring (⤡) a cell teleports it in the DOM, which blurred the xterm textarea — you had to click before typing. The cell that should be active now grabs focus automatically via the lightweight `conn.focus` (no socket reconnect).
- **Pin expand/close to the top-right when header info overflows** (#300, #299): when the header's first row (name badge / git branch / model·context / tokens) grew, it pushed the ⤢ and ✕ buttons off-screen. The info now lives in an overflow-clipping track with the action buttons as a fixed sibling, so overflow clips the info chips (right-most first) while the buttons always stay put.

### Refactoring, chores & docs

- **Drop `trackStyle`'s dead zoom argument** (#301): a leftover parameter and `0fr`-collapse branch from a superseded pre-FLIP zoom approach — reachable only from its spec — were removed; behavior unchanged.
- **Dependency update** (#307): refreshed `package.json` / `yarn.lock`.
- **Grid-view user guide on GitHub Pages, JA/EN** (#295): a user-facing guide (`/docs`, just-the-docs) that leads with the product concept — a terminal-first environment where one engineer supervises many parallel AI agents — organized around the Supervise / See / Automate-&-investigate pillars, then teaches the grid view.

## mulmoterminal@0.8.0 — 2026-07-09

Feature release: **Codex as a first-class agent** in the single view, a **configurable terminal header** (custom action buttons + display chips driven by JSON), **per-directory cell colors**, and a layer of **agent-state visibility** (git chip, model/context badge, estimated cost, tool-call timeline, AI command summaries).

### Highlights

- **Codex is a first-class agent, at parity with Claude in the single view** — Codex now drives the GUI panel (charts / forms / collections / images) through its own tool calls, appears in the **sidebar** with a `codex` badge, and its past conversations are **listable and resumable** (from `~/.codex` rollout files; `codex resume <id>` over `/ws/codex`). The collection browser gains a persisted **“Launch with” [Claude | Codex]** toggle, and mulmoclaude skills work in Codex (workspace `.claude/skills/*` mirrored to `~/.codex/skills/*`; `/<slug> <msg>` rewritten to `Use the "<slug>" skill. <msg>`). (#240, #249, #257)
- **Configurable terminal header (buttons + chips via JSON)** — the running terminal’s header is user-configurable from the existing config files (project `<cwd>/.mulmoterminal.json` + global `~/.mulmoterminal/config.json`, merged); **with no config it’s identical to before.**
  - **Action buttons** (`buttons`): `run:"input"` types text into the live session (e.g. `/compact`); `run:"open"` opens `url` / `reveal` (Finder) / `files` (in-app explorer) / `view` (prs/wiki/collections/accounting); `run:"shell"` runs `cmd` in a command cell (server re-resolves by id, `${vars}` shell-escaped, `cmd` never sent to the browser). `${var}` = dir/branch/repo/ahead/behind/dirty/agent/model/task; `when` = `isGitRepo` / `agent == …` / `repo == …` with `&&`/`||`. (#285, #288)
  - **Display chips** (`chips`): reorder/hide the grid cell header built-ins (`git`/`diff`/`ctx`/`usage`) and add custom `{ label, text, when }` chips. `chips: null` (default) renders as before. (#290)

    ```json
    {
      "buttons": [
        { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
        { "id": "gh", "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
        { "id": "build", "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
      ],
      "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }]
    }
    ```
- **Per-directory cell colors** — `headerColor` / `headerTextColor` (#280) plus `cellColor` / `cellBorderColor` / `dotColor` / `buttonColor` (#283) in `.mulmoterminal.json` (all `#rrggbb`) so each project’s terminal is visually distinct; the working/blocked status tint still overrides the background while active.

    ```json
    { "headerColor": "#0b3d2e", "headerTextColor": "#e2f5ec", "cellColor": "#0e1117", "cellBorderColor": "#1f6f4f", "dotColor": "#22c55e", "buttonColor": "#a7f3d0" }
    ```
- **Know what your agents are doing** — a **git status chip** in every header (`⎇ branch ●dirty ↑ahead ↓behind`, #248); a **model / context badge** (`Opus · ctx 35%`, #255); **estimated cost ($)** Session/Today/This-month in Settings (#256); an **activity timeline** 🕘 of tool calls (#250); and **AI Summarize/Explain** ✦ of Run-cell output with **⧉ Copy as prompt** (#251, #268).

### Also

- Launcher preset chips are tinted when their dir already has a running session (#259); the two-row cell header was tidied (info on row 1, action icons on row 2) (#261, #270); clicking a filmstrip thumbnail’s header whitespace zooms/switches to it (#253).

### Fixes

- **Shift+Enter inserts a newline** (send `\x1b\r`; a later xterm `preventDefault` regression also fixed) (#264, #293); **macOS Option acts as Meta** for Claude’s Alt bindings (#266); **per-model context window** in the ctx% badge (1M for current-gen models, was showing 470%) (#276); **header prompt resets on `/clear`** (hooks tagged with a stable `x-mt-session` id since Claude reissues `session_id` on `/clear`/`/compact`) (#292); files view returns to its originating view (#272); grid zoom / filmstrip header polish (#275, #278).

### Docs

- README refreshed for the current app (Claude & Codex, worktrees/PRs, cost & tokens, Wiki/Collections/GUI panel, endpoint tables) plus tmux install instructions (#286).

📦 **npm**: [`mulmoterminal@0.8.0`](https://www.npmjs.com/package/mulmoterminal/v/0.8.0) — `npx mulmoterminal@latest`

## mulmoterminal@0.7.0 — 2026-07-08

Feature release: an opt-in **Docker sandbox** for the single-view Claude session, **Codex as a first-class agent** alongside Claude, user-configurable MCP servers, more remote-host (phone client) capabilities, and terminal clipboard/scroll fixes.

### Highlights
- **Docker sandbox for the single-view Claude session (opt-in)** (#205, #208, #211, #221, #222): run `claude` inside a container so it can't reach the host filesystem outside the bind-mounts, host processes, or arbitrary host ports (the project dir and `~/.claude` are bind-mounted read-write by design). macOS-only, opt-in via `MULMOTERMINAL_SANDBOX=1`. Authenticates from the macOS **Keychain** (the live credential is exported read-only into the container and **re-synced on every reconnect**), reaches the host GUI MCP over `host.docker.internal`, and **auto-builds its image on first run** from the shipped `Dockerfile.sandbox` (rebuilds when the Dockerfile changes). Opt-in host credentials — `gh`, `.gitconfig`, SSH agent — via a fixed allowlist (`SANDBOX_MOUNT_CONFIGS`), all mounted read-only.
- **Codex as a first-class agent** (#237, #238, #239): a new `AgentAdapter` seam lets MulmoTerminal drive agents other than Claude, with Codex as the first. First-class Codex sessions on `/ws/codex` (spawn, discover, resume by rollout id), a **Claude / Codex toggle** in the grid cell launch form, and the client protocol to connect them.
- **User MCP servers for the single-view session** (#207): configure your own MCP servers for the interactive Claude session.
- **More remote-host (phone client) capabilities** (#227, #228, #229): `listSkills`, `getFeed`, and offline-queued `startChat` (protocol v2).
- **Terminal clipboard & scroll fixes** (#206, #214, #215): OSC 52 copy now reaches the browser clipboard — including **through tmux** (Claude's auto-copy in grid terminals) — and the grid-terminal mouse wheel now scrolls the buffer instead of cycling shell history.

### Also
- **Collection action fixes**: pass collection paths to action seed prompts (#212); deliver auto-run prompts by typing rather than a tmux-overflowing CLI arg (#213).
- **Code quality**: function-size + complexity ESLint guards promoted from warning to error, with the offending functions refactored to satisfy them (#225, #230, #231, #232, #233, #234, #235).
- **Dependency bumps**: `@mulmoclaude/accounting-plugin@0.3.2`, `@mulmoclaude/core`.

📦 **npm**: [`mulmoterminal@0.7.0`](https://www.npmjs.com/package/mulmoterminal/v/0.7.0) — `npx mulmoterminal@latest`

## mulmoterminal@0.6.2 — 2026-07-04

Feature release: a cross-repo PRs & Issues view, selectable launch commands, a full-screen file explorer + Markdown editor, and tmux-backed session persistence.

### Highlights
- **PRs & Issues view** (#183, #187, #190): a full-screen **Pull requests & Issues** view (toolbar `call_merge` button) that aggregates open PRs **and** issues across multiple repositories via your server-side `gh` login. Configure `owner/repo` entries in Settings → Pull request repos. PRs show CI rollup / review decision / draft badges; each repo lists its latest 20 open issues with a link to the rest on GitHub. Rows are real links (right-click / ⌘-click / middle-click work). Per-repo errors never sink the view, and the two endpoints load independently.
- **Launch commands in the grid cell launcher** (#182): a grid cell can launch **any configured program besides Claude** — a plain shell, `codex`, any interactive command — set in Settings → Launch commands as `{ label, command }` (e.g. `Shell` → `$SHELL`). A launcher runs as a **persistent, reattachable terminal** in the cell's directory (survives page switches / reconnects); its dot shows running vs. exited.
- **Full-screen file explorer + Markdown editor** (#184): every terminal header has a 📁 **Files** button that opens a full-screen explorer rooted at that terminal's project dir. A lazy directory tree + a **CodeMirror 6** editor (Markdown / JS-TS / JSON), a Markdown **Preview** toggle (sandboxed), and Save (⌘/Ctrl-S). Reads and writes are contained within the project root — `..`/absolute/symlink escapes are rejected.
- **tmux-backed session persistence** (#197): if `tmux` is installed, Claude sessions and launchers run inside a tmux session, so **a server crash or restart no longer kills your terminals** — the processes keep running and reattach when the server comes back. It uses its own isolated tmux server (never your personal tmux). **No tmux → non-persistent fallback**, exactly as before.
- **Settings modal overflow fix** (#196): the Settings modal now scrolls internally when tall (the Launch commands section had pushed it past the viewport).

Also: dependency bump to `@mulmoclaude/core@^0.8.1` / `@mulmoclaude/collection-plugin@^0.7.0` / `tsx@^4.23.0` (#186), and internal plan-file tidy-ups.

📦 **npm**: [`mulmoterminal@0.6.2`](https://www.npmjs.com/package/mulmoterminal/v/0.6.2) — `npx mulmoterminal@latest`

## mulmoterminal@0.6.1 — 2026-07-03

Patch release: the three grid features merged since `mulmoterminal@0.6.0`.

### Highlights
- **Agent state split** (#174): grid cells now distinguish **blocked** (waiting on a permission/question), **done** (finished a turn, output unreviewed), **working**, and **idle** — each with its own color (blocked = amber glow, done = blue glow, working = pulsing blue), and the auto-order is refined to `blocked > done > idle > working`.
- **Per-cell token usage badge** (#175): each cell's header shows its session's cumulative tokens (⇡ input incl. cache · ⇣ output), k/M-formatted with a breakdown tooltip, refreshed when a turn finishes.
- **Grid status summary** (#178): the toolbar shows an at-a-glance tally across all pages — how many cells are blocked (need input) / done (review) / working — so you can tell something needs you even when it's on an off-screen page.

### What's Changed
* docs: add docs/ChangeLog.md (mirror of the 0.6.0 release notes) by @isamu in https://github.com/receptron/mulmoterminal/pull/172
* feat: エージェント状態を blocked / done / working / idle に細分化 (#174) by @isamu in https://github.com/receptron/mulmoterminal/pull/176
* feat: セル別トークン使用量バッジ (#175) by @isamu in https://github.com/receptron/mulmoterminal/pull/177
* feat: グリッド状態サマリーをツールバーに表示 (#178) by @isamu in https://github.com/receptron/mulmoterminal/pull/179
* chore: bump version to 0.6.1 by @isamu in https://github.com/receptron/mulmoterminal/pull/180

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.6.0...mulmoterminal@0.6.1

## mulmoterminal@0.6.0 — 2026-07-02

This release lands 41 commits since `mulmoterminal@0.5.0`, focused on navigation, session/terminal persistence, the launcher, content browsing (collections + wiki), runtime translation, and a set of safety guards.

### Highlights

#### Navigation & terminal persistence
- **vue-router for top-level navigation** (#161): the app's top-level views are now driven by vue-router instead of ad-hoc local state, giving real routes for the single view, grid, collections, wiki, and accounting.
- **Terminals survive navigation** (#158): switching between views no longer tears down the PTY WebSocket — a terminal you leave keeps running and reattaches when you come back, instead of reconnecting from scratch.
- **Dynamic favicon** (#154): the browser tab favicon reflects live session state (a terminal `>_` mark that switches between working / needs-attention / idle), reconciled against the authoritative session list so it stays correct after prune/reconnect.

#### Launcher & working directories
- **Recent working directories in the launcher** (#155): an empty cell launcher remembers the directories you've started terminals in, so you can re-pick them quickly.
- **Auto-recorded directory presets** (#164, #163): launched directories are captured automatically as presets in most-recently-used order, and legacy `localStorage` recents are migrated forward. The manual "Directory presets" editor in Settings was removed in favor of this.

#### Collections, wiki & custom views
- **Collection registry import** (#157): a Discover tab wires the collection plugin host bindings — importing from a registry, listing feeds, and delete bindings for collection / feed / view.
- **Read-only Wiki browser** (#165): browse a wiki inside MulmoTerminal.
- **Custom-view write tier** (#167): `PUT /view-data` lets custom views persist data.
- Bump `@mulmoclaude/accounting-plugin` to 0.3.1 (#168).

#### Runtime translation
- **Translation service via a hidden chat** (#145, #150): `POST /api/translation` performs on-demand translation through a hidden Claude chat, and draft chat for collection starters was fixed alongside it.

#### Safety & UX guards
- **Confirm before closing the tab** (#149): closing or reloading the tab while a terminal is live pops the browser's native confirm dialog, so MulmoTerminal isn't closed by accident. It stays silent when nothing is running.
- **No false prompt on dev reloads** (#166): Vite HMR full-reloads are exempted from the close guard, so saving during development doesn't trigger the dialog.
- **Don't reap active chat sessions on switch-away** (#152): working/waiting sessions are kept alive when you switch away from them.
- **Hide grid sessions from the chat sidebar** (#169): multi-terminal grid sessions no longer clutter the single-view chat sidebar.

#### Server & housekeeping
- Move the GUI MCP endpoint under the `/api` prefix (#160).
- Archive completed plans into `plans/done/` (#151), docs updates (#159), and dependency refreshes (#147, #162, #170).

📦 **npm**: [`mulmoterminal@0.6.0`](https://www.npmjs.com/package/mulmoterminal/v/0.6.0)

### What's Changed
* feat: runtime translation service via hidden chat (POST /api/translation) by @snakajima in https://github.com/receptron/mulmoterminal/pull/145
* feat: activate translation + fix draft chat for collection starters by @snakajima in https://github.com/receptron/mulmoterminal/pull/150
* chore: archive 36 completed plans into plans/done/ by @snakajima in https://github.com/receptron/mulmoterminal/pull/151
* fix: don't reap working/waiting chat sessions on switch-away by @snakajima in https://github.com/receptron/mulmoterminal/pull/152
* feat: タブを閉じる/リロード前に確認ダイアログ（ターミナルがあるときのみ） by @isamu in https://github.com/receptron/mulmoterminal/pull/149
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/147
* feat: 動的 favicon（ターミナル >_ マーク・状態で切替） by @isamu in https://github.com/receptron/mulmoterminal/pull/154
* feat: remember recent working directories in the cell launcher by @snakajima in https://github.com/receptron/mulmoterminal/pull/155
* feat: persist terminal connections across UI navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/158
* docs: update product-profiles plan for MulmoBooks decisions by @snakajima in https://github.com/receptron/mulmoterminal/pull/159
* refactor(server): move GUI MCP endpoint under /api prefix by @snakajima in https://github.com/receptron/mulmoterminal/pull/160
* feat: adopt vue-router for top-level navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/161
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/162
* feat: wire collection plugin host bindings — registry import + feeds list + delete by @isamu in https://github.com/receptron/mulmoterminal/pull/157
* feat(wiki): read-only Wiki browser on MulmoTerminal by @snakajima in https://github.com/receptron/mulmoterminal/pull/165
* feat(unload-guard): skip the close confirm for Vite HMR reloads by @snakajima in https://github.com/receptron/mulmoterminal/pull/166
* Wire the custom-view write tier (PUT /view-data) by @snakajima in https://github.com/receptron/mulmoterminal/pull/167
* feat: 起動 dir を自動 preset 化し Settings の Directory presets を撤去 (#163) by @isamu in https://github.com/receptron/mulmoterminal/pull/164
* chore: upgrade @mulmoclaude/accounting-plugin to 0.3.1 by @snakajima in https://github.com/receptron/mulmoterminal/pull/168
* fix: hide multi-terminal grid sessions from the chat sidebar by @snakajima in https://github.com/receptron/mulmoterminal/pull/169
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/170
* chore: bump version to 0.6.0 by @isamu in https://github.com/receptron/mulmoterminal/pull/171

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.5.0...mulmoterminal@0.6.0
