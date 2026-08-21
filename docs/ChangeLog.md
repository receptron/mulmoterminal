# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

This file records **what changed and why**. For **how to actually use** a new feature, a release may also ship a dated setup guide — linked at the top of its entry, and written as a snapshot of that moment. The living reference is always the [guide](https://receptron.github.io/mulmoterminal/).

## Unreleased

Entries here are folded into the next release's heading when it ships.

### The shared-app templates teach a look, not only a declaration

Six of the seven templates carried one line of CSS, and that line was the canvas floor rather than
a style — so the pages an agent produced from them arrived as grey boxes, and a grey booking form
reads as unfinished rather than as plain. A template is copied VERBATIM (the reason its canvas rule
is asserted in the tests), which cuts both ways: three colours from `project-board.md` turn up in
generated apps as literal hex, unchanged.

`templates/design.md` is the reasoning — a palette derived from one hue the author picks for the
app, fluid type, a radius and a shadow that descend with the nesting, and what to do about a CSP
that loads no stylesheet, no webfont and no image. Each template now ships a real sheet at a hue of
its own, and two tests hold that: no two templates may share a hue, and the guide's worked palette
may not reach one.

The palette is `oklch()` rather than hex because hex cannot be parameterised — there is no
`#var(--hue)`. Across the six hues, with one set of lightness and chroma values, every foreground
pair clears WCAG AA with a spread under 0.5.

### A registration could be mistaken for a claim on a project board (#1814)

Reported from a published board. Somebody who had not registered pressed 「これをやります」, was
carried to the name field, registered — and left believing they had taken the work. They had not:
the press they made turned `#me` into 「◯◯ として参加中です」, which was the only change where
they were looking, while the half that mattered sat in `#say` at the foot of a page they had just
been scrolled away from.

One gesture writes once, so the second press cannot be removed; what is removed is not KNOWING
that one is owed. The board remembers the task a refused take was aimed at, carries the reader back
to that row once the registration lands, and puts the next step in the row itself — in three
wordings, because a task taken by somebody else during the typing must not be promised. `#say` now
names the thing that did NOT happen.

### `todo-board` is gone; use `project-board`

The two boards differed only in whether a roster exists, and the lesson `todo-board` was pointed at
for — `uidField` — is used by `project-board`'s `assignments` as well. It shipped as a demo of that
feature; `project-board` was extracted from a board that actually ran, and the one app started from
`todo-board` was hand-built into `project-board`'s shape before the template existed. Six templates
remain.

## mulmoterminal@4.10.1 — 2026-08-20

> **Setup guide:** [A scrollbar attached to nothing, and prompts you can copy](https://receptron.github.io/mulmoterminal/guide/en/v4.10.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.10.1.html))

Two fixes you can see, a shared-app preview whose desk actually moves records, an identity that
carries no address, and a test suite with no time budgets left in it.

### A zoomed cell grew a scrollbar attached to nothing (#1762, #1807)

Enlarging a cell from the roster could leave it with a scrollbar that scrolled nothing: the thumb
dragged independently of the terminal, the wheel still reached the agent, and it never went away
until the next resize.

xterm stops drawing a cell that is off-screen, and a resize arriving while it is paused updates the
**row count** immediately but defers the renderer's **dimensions**. The viewport builds its scroll
range from both, so it ends up with the pre-zoom canvas height and the post-zoom content length —
a scroll range that does not exist. On the alternate screen (a full-screen TUI redraws in place)
nothing ever calls `_sync()` again, so it stays wrong. The roster hit it every time, because that
cell was parked at `left: -99999px` until the moment it was enlarged.

Now the fit is **held while the cell is off-screen and run inside the delivery that brings it
back**, so xterm's own paused resize is flushed in the same batch. The rule is a pure function
(`src/composables/terminalFitGate.ts`), and the size handed to the PTY was measured as identical
with and without the fix, in every view state. This is also an upstream xterm.js defect — a paused
resize is deferred and the viewport is never re-synced.

### The prompts pane could be read but not copied (#1806)

A prompt row in the right panel was one big `<button>`, and a browser makes a button's contents
unselectable — so dragging across your own prompt started no selection at all. The button is now
just the header row (time plus the expand chevron, with `aria-expanded` intact), and the prompt
text sits outside it as selectable text. A click that ends a drag-selection no longer collapses the
row, which would have thrown the selection away; that rule is a tested pure function
(`src/components/textSelected.ts`).

### Shared apps (#1797, #1800, #1801, #1802, #1804, #1805, #1808)

- **The pane's desk performs what its buttons say (#1802).** Opening a member or participant page
  in the Collections pane drew the desk's controls and then failed every one of them with
  `read-only` — the member parent was never handed a `perform` port. `transition` / `assign` /
  `withdraw` now run, and the decision is made **on the server, before the write**, by the same
  `readIntentMessage` mulmoserver uses on `/m/` and `/p/`: the author owns the app, so deferring to
  the deployed rules would let the preview succeed at operations the page on screen forbids. The
  ask carries **which page it came from**, writes go out as a batch (rules read the second half of
  a pair with `getAfter()`), and headless `preview` runs still do not perform anything.
- **Identity without an address: `uidField` (#1805, #1808).** An app that spends its document id on
  exclusivity — a shared TODO board where the claim's id *is* the task's id — could only identify a
  person by `emailField`, which publishes an address next to a name on a world-readable row.
  `uidField` says the same thing with no address: the host validates the field exists and is a
  string, keeps it out of the public form (the box is writable and every value written to it is
  refused), and fills it from the session on write. A sixth template, `todo-board`, ships with it.
  It was published as `protocol: "2.0.0"` and walked back to no version at all (#1808), after
  measuring that an old reader already refuses the projection and that nothing reads a minor
  difference; the invariant that makes that safe is now pinned in `publicForm.spec.ts`.
- **A submission that cannot form an ID is refused by name (#1800).** `auth.uid+field` with an
  empty field returned `"<uid>_"` — a *valid* document id — so two different claims by one person
  collapsed onto one document. `missingIdField()` now asks before `recordId()` and names the empty
  field. With `sharedapp` 0.16 a whitespace-only answer counts as missing (stored values are still
  never trimmed), and `submit.stampField` is passed to `writableFields()` so the shared function
  also knows which fields a visitor never chooses.
- **The live-poll desk closes the current question before opening the next (#1801).** The audience
  page shows the lowest-`order` question that is `open`, and the template's desk had only per-row
  toggles — so opening the next question left the previous one open and the audience did not move,
  while the transition returned success and the row read "open". The desk now does it in two
  ordered writes and stops if the close is refused. `SKILL.md` gained the general form:
  `transitions` can only judge one record, so an invariant across records is executed by the page.
- **Which screen the page shows is decided from the data (#1804).** Two published-survey bugs — a
  cancelled submission showing results, and a returning visitor being shown the form again — had one
  cause: the page decided from what happened in *this tab*. Render from `onState` only; `cancelled`
  is a third outcome, not a failure (four templates were reporting "could not send" to someone who
  pressed *cancel*).
- **The audience page absorbs a refusal it cannot avoid (#1797).** A sandboxed page has no
  `localStorage`, `sessionStorage` or `cookie` — all three raise `SecurityError` — so after a reload
  it cannot know it already voted, and `viewer.mine` cannot answer for a composite id. It now states
  the refusal and stops instead of inviting another press, and does not count a cancel or a
  double-press as one.

### Tests (#1737, #1796, #1798, #1799)

- **Waits are named conditions, not time budgets (#1796, #1798).** `test_windows` failed on a
  different spec every run. Counting the hops one spec actually needed showed 1 required against 1
  provided — zero slack — so one extra `await` anywhere upstream read an array before the answer
  landed. All 39 waits in the touched specs are now named conditions, the `settle()` helper is gone,
  and three more specs carrying the same 300ms budget were fixed with them.
- **The suite opens no sockets (#1737, #1799).** Every `request(app)` was a listener on an ephemeral
  port — invisible to a `grep listen(` — and under load they failed with `socket hang up`. All 23
  specs moved to `light-my-request` in-memory injection through an adapter that returns supertest's
  shape, so not one assertion was rewritten to prove a transport change. The two places where the
  adapter differs (empty body, top-level array) are pinned by spec, `supertest` is out of the
  dependencies, and `remoteHost/routes.spec.ts` went from 13 listeners to 1 to 0.

## mulmoterminal@4.10.0 — 2026-08-19

> **Setup guide:** [The machine's own load, in the header](https://receptron.github.io/mulmoterminal/guide/en/v4.10.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.10.0.html))

One number added to the grid header, one pane tidied, a Claude session readable from the phone,
and the shared-app format moved to `sharedapp` 0.13.

### The machine's load, beside the usage gauges (#1786, #1791)

"May I start another agent right now?" is a question about **this machine**, and it was the one
number the grid header did not carry. It does now: `load 334%` sits beside the 5h / 7d windows, as
a **percentage of the cores** — 66.8 runnable processes on a 20-core machine. 100% means every core
has work queued and one more cell slows the ones already running (amber); 200% means everything is
waiting for a core (red). Hover gives the raw 1 / 5 / 15-minute figures, the core count and the
multiplier.

It reads `os.loadavg()` on the host running the sessions, polled every 10 seconds through a new
`GET /api/load`, and the reading it shows is never more than 60 seconds old — a failed poll holds
the last figure through a blip, and a remount gets back the *remainder* of that window rather than
a fresh one. **A host that keeps no load average shows nothing rather than `0%`**: Windows returns
`[0, 0, 0]` there, and an idle machine and an unmeasurable one must not look alike.

Switch it off with `"showLoadAverage": false`, or the checkbox in Settings → **Grid header
read-outs** — a new pane under Appearance.

### The collections pane has one toolbar (#1784)

The bar used to be drawn only in a directory that declared a shared app, so it appeared and
disappeared as you moved between cells and there was nowhere to put anything that was not about an
app. Now the bar is always there and only the individual controls come and go; **expand** and
**close** live in it, and a preview opens by default.

### A Claude session, read from the phone (#1751, #1776)

The phone's remote terminal could only ever show the **current screen** of a Claude cell — claude
runs on the alternate screen, so there is no scrollback to fetch and `capture-pane` returns the
30–41 rows of the pane. The host now answers `getTerminalTranscript`, reading claude's own
transcript instead of the pane, so the phone client can page back through the conversation.

### Shared apps (#1764, #1770, #1774, #1781, #1790, #1792, #1793, #1794, #1795)

- **The headless preview is the pane's preview.** Both run the same `@receptron/sharedapp/view`
  modules that `mulmoserver`'s public page runs, so what an LLM is shown headlessly and what a
  person sees differ only in the chrome the host wraps around them (#1764, #1770).
- **`sharedapp` 0.11 → 0.13.** Live views are declarable and checked (#1790), a projection now
  carries the `protocol` — the publish contract's version — so a document says which rules it was
  written under (#1794), and the deployment/capabilities gate was dropped: the question it asked
  ("what can this deployment serve?") was the wrong one, and the document itself answers the right
  one at the moment it is drawn (#1793).
- **Templates that say who reads the answers.** Some published apps had one public page and no
  place to read what came back; the form-shaped templates now ship all three views (#1774), and a
  live-poll template was added (#1792) and made anonymous (#1795).
- **`aid` cannot be minted twice.** "It is stuck, let me delete the `aid`" is exactly what an agent
  reaches for, and publishing then silently minted a second app. Publish now refuses instead, and a
  partial state is handed the steps that recover it (#1781).

### Fixes

- **A cell's title is read, not generated (#1769, #1772).** The `claude -p` session that existed
  only to write a cell heading ran `git restore` and `git push origin main` in the working
  repository. The title now comes from the transcript, so nothing is spawned to produce it.
- **The launcher no longer comes up empty (#1771).** The saved-directory chips, the WORKSPACE chip
  and a dozen global settings all come from one `GET /api/config` issued once at boot; a backend
  still restarting answered nothing and the row stayed blank until a reload. The request retries.
- **Codex "OR RESUME HERE" shows your own conversations (#1777, #1782).** The cwd filter ran after
  the overall scan limit, so subagent rollouts filled the list and the entries all read
  `Codex session`.
- **`yarn dev`: HTML outside `artifacts/` opens in the Canvas again (#1758, #1775).** The Vite dev
  proxy had no `/htmlfile` entry, so the SPA catch-all answered with the app's own `index.html` and
  the sandboxed iframe failed on CORS.

### Docs (#1767, #1780)

The 4.9.0 guide no longer describes the shared-app work that did not ship in it, and the primary
material that had misled four external reviews was corrected.

## mulmoterminal@4.9.0 — 2026-08-17

> **Setup guide:** [The prompts pane](https://receptron.github.io/mulmoterminal/guide/en/v4.9.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.9.0.html))

One new panel, which answers "what did I ask *this* cell?".

### A pane for the prompts you sent (#1748, #1749)

With several cells running it stops being obvious which one you told what. The three existing
clues each answer with exactly one item — the cell header shows the latest prompt, the Activity
timeline shows what the **agent** ran, and the roster row shows what the agent **said**. None of
them is a list of what **you** asked for.

The new pane is that list. Open it with the **`forum`** button on an enlarged cell ("Show the
prompts you sent this session"); it draws newest-first, is read-only, expands a long prompt in
place when clicked, and keeps up by itself if you leave it open. Claude and Codex.

**It reads what you TYPED, and that is not the agent's transcript.** Measured on a live session: a
prompt sent *while a turn is running* is written to `~/.claude/history.jsonl` within milliseconds
but never appears in the transcript as a `type:"user"` record — it arrives as `queue-operation` /
`attachment` — while text a **skill** injects *does* appear there as a user record. So the
transcript drops the interruptions (the very prompts you forget giving) and adds text nobody
typed. `history.jsonl` carries one line per submission and nothing else, which is why it is the
source.

Three things the review changed after the plan was written, each measured rather than reasoned:

- **`/compact` does not reissue the session id.** A comment in `activity-hook.ts` said it did, and
  a chain of id-mapping had been built on that comment. Measured across every transcript on the
  development machine — 95 compacted, 61 with prompts after the compaction — the session id was
  identical in all of them. The chain was deleted and the comment corrected.
- **After `/clear`, prompts from before the clear are not shown.** The header, the AI title and
  the latest reply all go blank on a clear; this pane alone was still showing the finished
  conversation. The boundary is drawn on **time**, not on the id, because whether `/clear` reissues
  the id could not be measured and an id-based implementation fails toward a permanently empty pane.
- **That boundary is now persisted.** Both the time and claude's id at the moment of the clear were
  in memory and lost on a restart — losing the time resurrects the erased conversation, losing the
  id empties the pane. Both moved onto the `~/.mulmoterminal/cleared-transcripts/` mark that
  already records the clear.

### The pane resumes instead of re-reading (#1750, #1753)

`~/.claude/history.jsonl` is 8 MB on the development machine and was scanned end to end on every
poll. The scan now resumes from where it stopped, reading only what was appended, and everything a
scan reads comes from **one file handle** rather than a path re-resolved per read — a path can
land on two different files across two reads, and a reader that folds a range and then checks
something else about "the file" has no way to say the two saw the same one.

### Fixes

- **The dev server restarted forever on a port collision (#1735, #1736).** A port already in use
  made it exit, which made it restart, which made it exit. It now reports the collision and stops.
- **`collection-plugin` is on 4.2.0 (#1754)**, and a recorded timestamp is no longer editable from
  the pane — it is the server's record, not a field.
- **The Windows PTY specs get a 60-second timeout (#1740, #1741).** They drive a real PTY, and the
  Windows runner is slow enough that the default was the thing failing, not the code.

### Plans and docs

`#1755` records the design for reading a Claude transcript on the phone — the terminal screen
cannot answer it, because claude runs in the alternate screen where tmux keeps no scrollback
(measured: `alt=1 hist=0` on 11 of 12 live sessions). `#1734` is 4.8.5's setup guide.

### Docs housekeeping

Release pages in the guide are renumbered so `nav_order` **descends as the version rises**: the
oldest page is `10000000` and each newer one is one less. Adding a release used to renumber all
fifty pages in both languages — it is now one new file per language, taking the next number down,
and nothing else moves. The large starting point is deliberate: counting down from a small number
would eventually reach the reference guide's own `nav_order`s, and this repo has already been bitten
once by exactly that collision (just-the-docs breaks a tie by title, so the sidebar reordered itself
with nothing erroring).


## mulmoterminal@4.8.5 — 2026-08-15

> **Setup guide:** [Windows shells, tmux 3.7, and Google sign-in](https://receptron.github.io/mulmoterminal/guide/en/v4.8.5.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.5.html))

Windows, tmux 3.7 and the remote host's Google sign-in. **If the tmux one hit you, updating is not
enough on its own** — the setup guide has the single command that recovers it.

The two shared-app changes below are not in that guide yet; they are user-facing enough to want
screenshots, so they get their own page (#1733).

### Windows: a Shell cell died the instant it launched (#1717, #1718, #1720, #1724)

A Shell cell failed immediately on Windows while Claude and Codex cells in the same window were
fine. `$SHELL` is an executable **path**, and Git for Windows sets it to
`C:\Program Files\Git\usr\bin\bash.exe` — that reached PowerShell as a command string and was
split at the first space, so `C:\Program` was reported as an unknown command.

**Quoting alone would not have fixed it.** In PowerShell a quoted path is a string *expression*:
the path is echoed and no shell starts, which is a terminal that opens onto nothing — worse than
an error, because nothing reports it. The call operator `&` is what executes it.

The follow-up removes the parser rather than satisfying it. A shell **this app chose** is now
handed to the PTY as a program with no shell in between; a launcher chip — a command line the
**user** wrote, with pipes and `$VAR` to expand — still goes through one. The asymmetry is
deliberate and by trust of origin, not by platform: on POSIX the `$SHELL -lc` wrapper is
load-bearing, because `-l` is what sources `.zprofile`, and dropping it would quietly lose the
user's login PATH.

### tmux 3.7: every new session died after a worktree was deleted (#1725)

Reported by @michiof. On tmux 3.7, deleting a git worktree could leave the tmux server holding
that directory, after which **every new session on the host died at startup** while existing ones
carried on. Restarting MulmoTerminal did not help: the broken thing was the tmux server, which
outlives the node process.

tmux 3.7 moves the server's working directory to the client's on every `new-session` and never
restores it, and `spawn_pane()` guards its `chdir` on `getcwd()`. Once that directory is gone the
guard skips the chdir entirely, so a later pane ignores `-c` and starts in the deleted path —
where a program that calls `getcwd()` as it starts (the claude binary does) dies on the spot. The
tmux client is now started from a directory this app never deletes; the pane still opens where the
cell asked, verified on tmux 3.2a, 3.4, 3.6a and 3.7b.

Reported upstream as [tmux/tmux#5473](https://github.com/tmux/tmux/issues/5473). **tmux 3.6 and
earlier were never affected**, which is why this arrived with the Homebrew upgrade to 3.7.

### Remote host: Google sign-in lost the credential (#1731)

`firebase` is pinned to `12.16.0`. `@firebase/auth` 1.13.4 added a `visibilitychange` listener
that treats `visibilityState === 'hidden'` as page teardown, so signing in through a popup — which
backgrounds the opener — throws while persisting the credential to IndexedDB. The network call
succeeds and nothing is saved. Reads swallow the same condition and return `[]`; only writes throw.

The upstream fix ([firebase-js-sdk#10300](https://github.com/firebase/firebase-js-sdk/pull/10300))
is merged but not on npm, so pinning is the only route today. The pin carries no caret on purpose:
`^12.16.0` floats to 12.17.x and back onto 1.13.4. Already pinned in the reference host
(mulmoclaude #2912); this release closes that gap.

### Shared apps: see the participants' screen before publishing (#1707, #1726)

A shared app's view is written by an LLM, and until now authors published it without ever running
it. There is now a preview that runs it on the author's own machine, in a frame no looser than the
published one. Slot refill in the meeting-room template moves onto `putItems`'s `itemsFile`, with
`@mulmoclaude/core` at 4.1.1.

### Skills turned off stay off (#1698, #1714)

A skill set to `"off"` in `skillOverrides` still appeared in the Skill menu and in
`GET /api/skills`.

### Issue templates (#1715, #1716)

`.github/ISSUE_TEMPLATE/` now carries a bug report and a "problem or use case" form. The second
asks what you were trying to do and what got in the way rather than for a feature: a proposal
narrows the answer to the one already thought of, and when a proposal is turned down the problem
it came from is thrown away with it.

### Windows CI runs before merge (#1721, #1723)

`yarn test` on Windows now runs on every pull request that touches anything other than docs, plans
and markdown. Fifteen issues had been found only after landing on `main`. Only the tests run —
lint, typecheck and build answer the same on every platform and already run on ubuntu and macOS.

### Two flaky specs (#1719, #1722, #1729, #1730)

`SharedAppPreview` was missing a settle phase and failed only on the slower Windows runner: a
`MessagePort` delivery is not a microtask, and the one call site out of nine that omitted
`await settle()` read its answers before the queue had turned.

`sharedAppPreviewRoutes` opened a real TCP listener per request and failed 2 runs in 6 under
full-suite load — measured at 0 in 20 when run alone. The failures were not timeouts: one returned
**another server's HTML**. It now uses the in-memory `appRequest` helper the repo already has for
exactly this.

## mulmoterminal@4.8.4 — 2026-08-15

> **Setup guide:** [The notification body, and Japanese in the terminal](https://receptron.github.io/mulmoterminal/guide/en/v4.8.4.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.4.html))

Fixes only. Nothing to configure.

### A push notification whose body was your own prompt (#1696, #1710)

The body of a phone push was sometimes **the prompt the user had just typed**, word for word, on
finished turns and blocked ones alike. Reading your own words back says nothing about the turn
that ended.

The body is built from the agent's reply, and the reply was **re-read from the transcript file**;
`buildPushDetail`'s last resort when that read came back empty was the last prompt. Empty reads
are real — measured on this machine's transcripts, a turn ends with no reply at 1.5%–13.5% of
boundaries depending on how a boundary is counted (a turn stopped with ESC, or one that ended on a
tool call, genuinely has nothing to report).

**A `/clear`ed session hit it on every turn afterwards.** `notifyTaskFinished` skips the transcript
read while `clearedTranscripts` holds the session (#1085 — after a `/clear`, our copy is frozen on
the conversation the user ended), and that mark lifts only when *that* file grows. Claude writes to
a different file after a `/clear`, so it never does.

Two changes. The finished body now comes from the Stop hook's own **`last_assistant_message`** —
the reply, carried by the very event that reports the turn ending, so it cannot race the transcript
write, guess the wrong project directory, or miss a session id Claude reissued. The field was
present in every Stop payload captured from Claude Code 2.1.232 and was read nowhere in this repo.
The transcript read stays as the fallback for a Claude Code that predates the field and for codex,
which has no hooks at all. And **the last prompt is gone from the fallback chain**: the body is now
`reply || aiTitle || "the task finished"`, and for a blocked turn `message || aiTitle ||
"waiting for input"`.

Verified by running the new route spec against the old code: five of its six cases fail there with
the body equal to the user's prompt.

### Terminal Japanese arriving as runs of `_` (#1634, #1708)

An agent's Japanese output could arrive as `__________`, with box-drawing characters and `·`
unaffected — an asymmetry that pointed investigations at fonts and renderers.

The substitution is tmux's, at the moment its **client** writes to the pty (`tty_check_codeset`).
A client that finds no `UTF-8` / `UTF8` in the first non-empty of `LC_ALL` / `LC_CTYPE` / `LANG`
replaces every character with no DEC ACS fallback with **one `_` per cell** — two for a full-width
character. A process launched from a GUI inherits launchd's environment, which names no locale at
all.

Two fixes with different reach. The tmux client is now started with **`-u`**, which forces its
output to UTF-8 rather than deciding from the locale — not a guess about the user's terminal, since
the reader of that client's output is our own xterm.js. This is what closes #1634, and it covers a
machine that explicitly names a non-UTF-8 locale too. Separately, on macOS only, `LANG=en_US.UTF-8`
is supplied to a session's environment **when no locale name is present at all**, for everything
else in the session that decides its output encoding from the locale (a curses TUI, Python's
stdout). `LC_ALL` / `LC_CTYPE` take precedence over `LANG`, so an environment that already sets one
is untouched.

### A shared app's publish handed out a URL that does not open (#1697)

`publish` reported the app as open "at /{slug}", but the public page is served from **`/a/{slug}`**
— a bare `/{slug}` route does not exist and falls through to NotFound. The author passes that
string straight to visitors, so this was a broken address rather than an awkward message. The
roster and participant pages were also printed with a literal `/m/{slug}` placeholder instead of
the slug that is already known; the participant page named no address at all.

### The public view's link refusal did nothing on Windows (#1709, #1711)

`openContained`'s symlink defence rested entirely on `O_NOFOLLOW`, which **does not exist on
Windows**: `constants.O_NOFOLLOW` is `undefined` there, and `O_RDONLY | undefined` is `O_RDONLY`,
so the open silently degraded to an ordinary read with no error and no warning. This is what turned
`windows-daily` red from 2026-08-13; two of its three failing cases were the implementation, not
the test.

### Internal

- `github/codeql-action/upload-sarif` pinned to v4.37.7, up from v3.37.1 (#1712). The v3-to-v4
  difference is the runtime only — v4 runs on Node.js 24 — and `upload-sarif`'s inputs are
  unchanged.
- Design notes for shared-app view diagnostics and for previewing a shared app locally before
  publishing (#1701, #1704). No code.

## mulmoterminal@4.8.3 — 2026-08-14

> **Setup guide:** [Answering a question, at the desk and on the phone](https://receptron.github.io/mulmoterminal/guide/en/v4.8.3.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.3.html))

### Answer a Claude question from your phone (#1685, #1693, receptron/mulmoserver#182)

A Claude session that stops on `AskUserQuestion` can now be answered **from the phone**, as a card
under the terminal screen: the question, and every choice as a button
([guide](https://receptron.github.io/mulmoterminal/guide/en/phone.html#question-card)).

**The phone sends neither keys nor bytes.** The host hands it the question as Claude declared it —
header, labels, descriptions, multiSelect — and the phone answers with the option INDEXES. The host
then builds the arrows and Enter against the dialog **it** recorded. So nothing a remote client
sends can reach the PTY as a control byte, which is the boundary `sendTerminalInput` has drawn since
#445, drawn tighter: here there is no free text on the wire at all, except the one case below.

**Answering in your own words** works when a dialog asks one question and takes one answer: the words
go into the dialog's own **Type something** row, sanitized host-side like any other text. Several
questions at once, or a multi-select one, get buttons only — the keystrokes for words would stop at a
review screen or the next question, which is not an answer.

Unlike the pane, **the phone needs nothing turned on**. `questionPaneEnabled` is about a panel that
types into the terminal you are sitting at; on a phone nobody is at that keyboard, and without the
card there are no arrow keys to answer with at all.

One answer wins: the first to arrive claims the dialog, so the pane, the phone and the keyboard
cannot half-answer each other. A question answered elsewhere, a session with no live terminal, or an
answer that only partly reached the terminal are each reported to the phone in words it can act on.

### Answer a Claude question from a pane, without taking the dialog away (#1679)

When a Claude session stops on `AskUserQuestion`, the only way to answer was the terminal's own
arrow-key dialog. Turn on **Settings → Terminal keys → Question pane** and the same choices also
appear as buttons beside the enlarged terminal ([guide](https://receptron.github.io/mulmoterminal/guide/en/features.html#question-pane)).

**The pane does not replace the dialog — it drives it.** Picking a button presses the arrow keys and
Enter in the real dialog, still on screen in the terminal underneath. So whichever end answers first
wins, someone who prefers the keyboard notices no difference, and there is no second source of truth
to keep in step. Multi-question and multi-select dialogs work too, including their Submit row and
review screen; the sequences are measured against the real dialog rather than derived from the tool
schema, which lists fewer rows than the terminal shows.

Nothing new is registered with Claude Code: the choices ride the `PreToolUse` hook that has reported
every tool call all along, and `PostToolUse` is what tells the pane the dialog closed — in the
terminal, in the pane, or with Esc. Off unless asked for, and with the switch off nothing is
published at all, so a question leaves no trace in the browser.

**None of the options fits?** The pane offers a text box for the dialog's own **Type something** row
(#1693), on the one shape it was measured on: a dialog asking a single question that takes a single
answer. What you write becomes the answer, exactly as typing it into the dialog would. Several
questions at once, or a multi-select one, get buttons only.

Claude sessions only, since that is where the hooks are. **Chat about this** stays in the terminal.

### Shared apps stop waiting for a MulmoClaude release (#1675)

The code that turns a repository's `app.json` into the documents a published app is made of
— and the gate that decides what publish refuses — moved out of `@mulmoclaude/core` into
[`receptron/sharedapp`](https://github.com/receptron/sharedapp), published as
`@receptron/sharedapp`, which this repository now depends on.

Nothing an author writes changes, and no published document changes shape. What changes is
the cost of the next change. Adding a key to `app.json`, a check to the publish gate, or a
field to a projected document used to be a change to MulmoClaude, a CI run, a merge, and a
**human npm publish** before the work here could continue. In the 90 days before this, 24
commits went that way — and MulmoClaude used none of that code: it neither writes nor reads
a shared collection.

The collection RUNTIME stays in `@mulmoclaude/core` — discovery, the store, the Firestore
backend, the host seam — because MulmoClaude does use those. The line is declaration to
document; anything touching a live collection is on the other side of it.

It ships as `@receptron/sharedapp` on npm. A git-ref dependency was the plan and does not
work here: MulmoTerminal is itself an npm package and ships `server/`, so every
`npx mulmoterminal` user would clone that repository and run `tsc` before their terminal
started. The gate it replaces is not the one it escapes — releasing it is one package with
no dependents to bump, no plugin peer ranges, no changelog check and no e2e suite.

`test/fixtures/sharedAppGolden/` keeps a picture of the two `{tier}/config` documents, so a
change to what a published app carries shows up as a diff rather than only as a test.

Design: [`plans/done/refactor-shared-app-module.md`](https://github.com/receptron/mulmoterminal/blob/main/plans/done/refactor-shared-app-module.md).

### The staff page can approve, and the people on the roster have an entrance of their own (#1671)

> **Needs a mulmoserver deploy, and every app published again.** `@mulmoclaude/core` 3.15.0
> (mulmoclaude#2891) is in, and it is what projects `write`; until the runtime is deployed and an
> app is published on top of it, its staff page stays read-only rather than guessing.

The staff page shipped read-only: seeing today's bookings was possible from a phone, approving one
still meant opening the owner's Mac. And a `participant` page — declarable since #1667, published
to the roster tier — had no URL after publish, so it reached nobody.

Both are answered here, and **no Firestore rule changed to do it**: `updateWith` already admitted a
writer, a row's own assignee, and a participant editing their own row, with the declared state
machine binding all three. What was missing was the client.

A view may now call, besides `submit`:

```js
await window.__MC_APP_VIEW.transition(cid, itemId, to);  // approve, reject, cancel
await window.__MC_APP_VIEW.assign(cid, itemId, address); // hand a row to a colleague
```

- **The vocabulary is closed and a page cannot name a field.** `transition` moves
  `collections.<cid>.statusField`, `assign` moves `assigneeField`, and nothing moves anything else.
  A general patch would be no less safe — the rules bind either way — but a mis-wired button would
  reach as far as the member's role does, with nothing above able to say what happened.
- **Each audience gets its own transition table.** Staff move along `transitions`, the person who
  booked along `public.submit.<cid>.selfTransitions`. Publishing one table to both would draw an
  approve button on a customer's page that the rules refuse when pressed.
- **The approval notice is written in the same batch as the record**, because the rules require it:
  `mailAgainst` compares the record before and after and demands the status actually moved, so a
  separate write could never have sent one. There is therefore no "approved" state with no notice
  queued beside it — what happens to the queue afterwards is the mail extension's business, not
  something a batch can promise.
- **Being shown the page is not permission.** `/m/{slug}` admits anybody holding a role anywhere in
  the app, so a `viewer` reads the same declaration as the front desk. The projection therefore
  carries the roster's answer — who may write every row, and who only their own — and the page
  hands the view its own address and a capability with the roles already resolved — both, because
  "may approve the rows assigned to you" cannot be drawn without knowing which rows those are. A view never sees a role name, and
  the same answer is applied again to every write. **A staff page published before this is
  read-only until it is published again** — a projection without those lists cannot tell a
  receptionist from an observer, so it refuses rather than assuming.
- **No confirmation dialog**, unlike the public path — the person pressing the button is on the
  app's own roster doing their own work. What replaces it is an account *outside* the frame: the
  page prints what was written, whatever the view chooses to draw about itself.
- **`/p/{slug}`** is the participant's entrance, linked from the public page beside the staff one.
  Not a signed-in branch inside `/a/{slug}`: that page's guarantee is that it draws itself signed
  out and shows nothing of the app's internal vocabulary. The two are not exclusive — an owner who
  also books is on both, and each address shows one face.

Design: `plans/done/feat-shared-app-member-write.md`.

### A shared app can have a page for its staff, not only for its visitors (#1667)

A published app had two faces: `/a/{slug}` for anonymous visitors, and `/staging/{aid}`, which
means "deployed, not yet published". A receptionist wanting today's bookings on their phone had
nowhere to go — and using staging after publish makes the live app and an unreleased version
indistinguishable.

`app.json` now declares pages per audience, generalising `public.view` (which still works and
normalizes into the first row):

```json
"views": [
  { "id": "public", "audience": "public", "path": "views/booking.html", "collections": ["slots"] },
  { "id": "desk",   "audience": "member", "path": "views/desk.html",    "collections": ["bookings"] }
]
```

`audience` decides which document the page is published to and therefore who may read it — a
Firestore rule cannot hide a field, so "the front desk sees this" is a **place**, not a filter.
`member` pages go where only a role-holder can read them, `participant` pages where the whole
roster can, and `public` keeps `config/view`. Splitting the data alone would not do it: the HTML
itself carries the app's internal vocabulary — status names, review-note headings, how work is
assigned.

Deploy stages the pages beside the schemas, so the roster can try the staff page at
`/staging/{aid}` before any customer sees it, and publish promotes exactly that — **never the
working tree**, so an edit made after the last deploy cannot go live unreviewed. A page dropped
from `views` is deleted at both ends rather than left readable.

**What a staff page is handed is not public data**, and publish says so in its output. The
argument that makes a public view safe — it can only carry off what any stranger could already
fetch — does not hold for the real records. The platform does not stop an owner's own page from
moving an owner's own data, and does not pretend to.

Needs `@mulmoclaude/core@3.14.0`, the Firestore rules from mulmoserver#168 (deployed), and the
`/m/{slug}` runtime from mulmoserver#169. Design and open questions:
[`plans/done/feat-shared-app-member-view.md`](https://github.com/receptron/mulmoterminal/blob/main/plans/done/feat-shared-app-member-view.md).
Writing from a member page — approving a booking, reassigning it — is not in this release.

### Someone who booked can take their own booking back (#1695)

A shared app's visitor could add a row and then had to ask the owner to remove it. An app can now
declare `selfDelete`, and the person who created a row gets a way to withdraw it — the collection it
belongs to reopens, so the slot is free again.

Withdrawing is the visitor's own row only, and it is a different act from the owner's "cancel": the
owner is deciding for somebody else, so the two are worded and confirmed differently rather than
sharing one button. Enforced where it has to be — [`firestore.rules`](https://github.com/receptron/mulmoserver), not here.

### Fixes

- A `lint` summary drew one block for a count of **zero**, so the emptiest row looked like the
  smallest non-empty one (#1676).
- Tests that reach the server through supertest were each starting their own listener, which could
  land a request on the wrong one (#1677).

### Under the hood

- `lint` is split into a **local** and a **CI** script, because the two want opposite cache
  strategies — cold 62.8s → 22.2s locally, and CI back to 110s (#1680, closes #1644). Test jobs
  declare their environment, `node_modules` is cached, and the eslint cache no longer misses a
  dependency (#1687, closes #1686).
- Lint warnings are down to **zero kinds**, with four rules that had been left loose raised to
  errors (#1683, #1689), and four duplicate-code alerts resolved by extraction (#1681).
- Ten finished shared-app plans moved to `plans/done/` (#1691), and the plan for moving the shared-app
  compiler out of `@mulmoclaude/core` is written down (#1674).

## mulmoterminal@4.8.2 — 2026-08-13

> **Setup guide:** [GitHub beside the cell, and a header you can read while it runs](https://receptron.github.io/mulmoterminal/guide/en/v4.8.2.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.2.html))

**Two screens stopped fighting the grid.** The GitHub view no longer takes the whole window to show
one project's issues, and a coloured header no longer becomes unreadable the moment its cell starts
working — with the colours for those states now yours to choose.

### GitHub opens in the cell's pane, on that cell's repository ([#1665](https://github.com/receptron/mulmoterminal/pull/1665), refs [#1664](https://github.com/receptron/mulmoterminal/issues/1664))

The view lists pull requests **and** issues, and it took over the whole screen to do it — reading one
project's issues meant leaving the grid and finding that project in a list of every registered repo.
It is now the **GitHub** view, it opens in the right pane beside an enlarged cell, and it **leads
with that cell's repository**.

Split rather than rewritten: `PrsOverlay` became `GithubPane` (the list) + `GithubOverlay` (the
full-screen frame and its route), the division `FilesPane` / `FilesOverlay` already used. Pane
exclusivity needed nothing new — `paneByCell` already holds one pane per cell, so `"github"`
inherits the rule.

**A block of its own, not a scroll.** A scroll that lands slightly off looks like nothing happened,
it has to re-run on every reload, and a repository with no open PRs and no open issues has nothing
to scroll to — where `No open PRs` at the top still answers "yours: none". The cell's repository is
lifted out into one section carrying both its PRs and its issues, above a rule.

Resolving which repository that is costs no extra request and no `git` subprocess at pane time:
`/api/repo-dirs` serves the reverse map (built from the registered `cwdPresets` by reading each
one's `origin`) and the view already fetches it. The match is **containment** — a cell in `repo/src`
leads with `repo`, and the deepest registered directory wins so nested clones and worktrees resolve
to the one the cell is actually in. Two conditions, both required: the cell's directory is inside a
registered directory that names a repository (so not-a-git-repo, no `origin` and an unreadable forge
all fall out here), and that repository is among the configured `prRepos`, since the lead block is a
section of that list. Otherwise the pane opens in the configured order.

`"prs"` stays a header-config value and `/prs` stays a route (redirecting to `/github`) — both are
things users wrote down, so the rename is the name they *reach*, not the name they *type*.

### The header's colours are resolved per status, and configurable ([#1619](https://github.com/receptron/mulmoterminal/pull/1619), fixes [#1617](https://github.com/receptron/mulmoterminal/issues/1617), refs [#1591](https://github.com/receptron/mulmoterminal/issues/1591))

A cell whose directory set `headerColor` + `headerTextColor` became unreadable **while it was
running**. Measured off the reporter's screenshot rather than described: the header background goes
from the directory's `#8e44ad` to the theme's `#d6e4fb` wash, and the declared white ink stayed on
top of it — **1.15:1**.

A *derived* ink was already dropped in those states; a *declared* `headerTextColor` was returned
before that check ever ran. So:

1. **A declared ink follows the same rule as a derived one** — it applies while the directory's own
   background is what shows. In `working` / `done` the theme's ink is used on the theme's wash, the
   pair they were designed as.
2. **Per-status header colours**, valid in a directory's `.mulmoterminal.json` and in
   `~/.mulmoterminal/config.json` as the default for every directory:

```jsonc
{
  "headerColor": "#8e44ad",
  "headerStatusColors": { "working": "#6d28d9", "done": { "background": "#166534" } },
  "headerStatusTint": "background"   // "none" keeps headerColor while working and done
}
```

`text` omitted derives an AA ink from `background` through the same `headerTextColorFor` a
`headerColor` already uses, so setting one colour cannot produce an unreadable header. There is no
`idle` — `headerColor` *is* idle, and a second way to say the same thing is how one directory ends
up written in two colours. `headerStatusTint: "none"` deliberately does **not** reach `blocked`: that
is the state where nothing proceeds until the user answers, and a switch whose purpose is "keep my
palette" taking the amber off it is an accident waiting to happen.

Both layers are resolved in one place (`common/headerStatusColors.ts`), so every caller asks "what
shows now" instead of combining the pieces itself.

**Not fixed by this**: with nothing configured, the theme's dim chip ink on its status tint measures
1.9–3.1:1 across the four themes. The reported case goes from 1.15:1 to about 2.5:1; naming
`headerStatusColors.working` reaches 12.9:1. Whether to raise that floor for everyone is still open.

### A `finished` push no longer carries the previous turn's reply ([#1666](https://github.com/receptron/mulmoterminal/pull/1666), refs [#1650](https://github.com/receptron/mulmoterminal/issues/1650))

The phone's completion banner read `lastTurnFromClaudeParsed`, which returns the last **completed
exchange** and falls back to the previous one while a turn is in flight. That is the answer handoff
wants and is intended (#254 / #1487) — but push wants "what did the turn that just ended produce",
and the two diverge exactly when **a turn ends without producing a reply**: interrupted with ESC, or
finished on a tool call. `Stop` fires, there is no reply, and the turn before it was announced under
"finished".

Measured on this machine's real transcripts — **11,489 files, 13,200 turn boundaries**: 193
boundaries return an older turn's reply even with the whole turn on disk, and 1,629 do if the read
is one record early, returning stale text rather than `null` so the caller cannot detect it.

A turn-scoped read (conclusions after the newest prompt only) was added and **only claude's push**
uses it; unreadable leaves `null` and falls through to the existing chain (last prompt → AI title →
a generic line). Silence beats confidently showing an old answer. codex is deliberately untouched:
its `task_complete` record carries the reply itself, so the trigger cannot outrun its own data.

The issue stays open on purpose — Web Push **delivery order** is a second possible route that has
not been ruled out.

### Fixes

- **A replayed scrollback no longer starts with `�`** ([#1640](https://github.com/receptron/mulmoterminal/pull/1640), fixes [#1639](https://github.com/receptron/mulmoterminal/issues/1639)). The bounded tail already guarded a cut landing inside an escape sequence, but `slice` counts UTF-16 code units, so a cut between the halves of a surrogate pair kept the low half alone — legal JS, serialised without complaint, and visible as `U+FFFD` at the top of the screen restored on reattach. The guard now skips the orphan before the escape scan runs, and keeps the pair intact when the cut falls in front of it.
- **A new document can no longer overwrite an existing one** ([#1624](https://github.com/receptron/mulmoterminal/pull/1624), fixes [#1623](https://github.com/receptron/mulmoterminal/issues/1623)). `saveNewDoc` built `artifacts/documents/YYYY/MM/<prefix>-<rand>.md` from 32 bits of randomness, with the prefix coming from the LLM's title — so documents from one month sharing a prefix shared a 32-bit namespace — and wrote with a plain `writeFile`, which replaced the loser silently and returned success. The id is now 64 bits from `randomBytes(8)` (matching MulmoClaude's `shortId()`) and the write uses `flag: "wx"`, retrying on `EEXIST` and throwing after five attempts rather than giving up quietly.

### Under the hood

- **`yarn lint` caches** — 57.8s to 4.2s locally ([#1645](https://github.com/receptron/mulmoterminal/pull/1645), refs [#1644](https://github.com/receptron/mulmoterminal/issues/1644)), and the dead-code scan caches yarn too ([#1621](https://github.com/receptron/mulmoterminal/pull/1621), refs [#1618](https://github.com/receptron/mulmoterminal/issues/1618)).
- **The Windows daily job is green again** — five specs, three causes ([#1654](https://github.com/receptron/mulmoterminal/pull/1654), refs [#1653](https://github.com/receptron/mulmoterminal/issues/1653)).
- **`yarn lint:summary`** reports lint findings as a report rather than a wall ([#1647](https://github.com/receptron/mulmoterminal/pull/1647)).
- **Shared collections and shared apps** continue under the surface and are **not documented yet** — that work gets its own release entry and guide page when it ships. Nothing in an existing setup changes because of it.

## mulmoterminal@4.8.1 — 2026-08-10

> **Setup guide:** [A server that stops running out of terminals](https://receptron.github.io/mulmoterminal/guide/en/v4.8.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.1.html))

**A server that had been up for days could no longer open a terminal at all.** Every spawn leaked
two file descriptors on macOS — one of them a whole pseudo-terminal — so the count climbed until it
hit `kern.tty.ptmx_max` (511 by default) and every new session failed with
`forkpty: Device not configured`. Alongside it, two of the four things 4.8.0 said were missing from
per-folder collections have landed.

### The PTY file-descriptor leak ([#1597](https://github.com/receptron/mulmoterminal/pull/1597), fixes [#1595](https://github.com/receptron/mulmoterminal/issues/1595))

`node-pty` is pinned to `1.2.0-beta.15`. Nothing in this repository could fix it: the leaked
descriptors are opened by the native addon and never reach JS. The issue proposed calling node-pty's
`destroy()` from every `kill()` site, but measurement showed that reclaims nothing — the master it
closes is already closed by node-pty's own exit path. The two real mistakes are both in that
library's macOS `pty_posix_spawn`: the parent's slave descriptor is never closed, and the `low_fds`
cleanup loop skips index 0, which the guard loop leaves as the only entry it took. That second one
holds a whole pseudo-terminal against the system limit.

Verified on a live server rather than in isolation: six real terminal sessions opened and closed left
six pseudo-terminals held on `1.1.0` and zero on the beta. `test/server/session/pty-fd-leak.spec.ts`
counts real descriptors — both classes, since either mistake could return alone — so it keeps
answering the question for whoever upgrades node-pty next. macOS only; the bug is in that platform's
spawn path.

One upstream defect remains and is documented rather than worked around: the beta's cleanup loop
still reads out of bounds if `posix_openpt` fails three times in a row. `1.1.0` has the same read on
that path *and* leaks, no published version bounds the loop, and the trigger is a system whose
pseudo-terminals are already exhausted — the state this release removes.

### Per-project feed refresh and per-card project scope ([#1590](https://github.com/receptron/mulmoterminal/pull/1590))

Both items were blocked on the shared library and shipped as core 3.2.0 / collection-plugin 3.1.0.

A collection that refreshes by dispatching an agent can be scheduled in a project folder again. The
seed prompt addresses records root-relatively while the worker used to start in the host's
workspace, so a project's scheduled refresh wrote into the **workspace's** same-named collection —
silently, since both paths exist. core forwards the root now and it becomes the worker's cwd. The
calendar stays workspace-only: a Google grant is user-scope, so a per-project sync would need a
per-project answer to "which account".

A card's binding is fixed to the project it was made in, instead of following whichever surface is
active — which is why a card built in project A showed project B's records after the app moved.
Everything project-dependent goes through the scoped resolver; what is per-surface rather than
per-project (navigation) is built outside it.

A feed collection's ignored records are now a warning rather than a portability blocker: a feed's
records are a cache the clone re-fetches, so the cost is a refresh, not the data. Ordinary
collections keep the blocker.

### The agent hears the portability verdict; the phone can list projects ([#1585](https://github.com/receptron/mulmoterminal/pull/1585))

A successful `putSchema` carries a `portability` field beside `written: true`. It is `putSchema` and
nothing else, because that is the only action that can change what the check reads — creation is a
plain file write the engine never sees. Quiet by construction: a clean collection is not mentioned,
and a check that cannot run changes nothing about a write that did happen.

`listCollectionProjects` returns `{ id, label }`, workspace first, and deliberately not the `cwd` the
browser's listing carries — the phone is genuinely remote, and an absolute root in a command or
artifact publishes the user's home directory over the wire. `docs/remote-host-protocol.md` records
the three rules: an opaque id is never a path, omitted means the host's workspace, and an
unresolvable id is an error rather than a fallback. The phone's own picker is still not in this repo.

`POST /api/config` now reports when the saved-directory list actually moved, and the watcher sync is
pulled forward instead of waiting out the 60-second poll — long enough that a new project's first
collection read as broken rather than pending. Compared by path, so a relabelled preset wakes
nothing.

### Header chips follow the directory's ink ([#1592](https://github.com/receptron/mulmoterminal/pull/1592), fixes [#1591](https://github.com/receptron/mulmoterminal/issues/1591))

With a saturated `headerColor`, the model/context badge and the usage chip stayed on `text-dim` and
could sink into the background while the path and title beside them followed correctly. The
`--cell-header-fg` chain those two already used is now a single named constant, and the three
stragglers are connected to it. Unset directories fall back to `--text-dim`, so nothing moves.

### Also

- The toolbar's Collections door wears the pane's own icon ([#1594](https://github.com/receptron/mulmoterminal/pull/1594)).
- Documentation: the Collections pane's browser verification is recorded ([#1593](https://github.com/receptron/mulmoterminal/pull/1593)), and the 4.8.0 notes say plainly not to put a collection in a project folder yet ([#1588](https://github.com/receptron/mulmoterminal/pull/1588), [#1589](https://github.com/receptron/mulmoterminal/pull/1589)).

## mulmoterminal@4.8.0 — 2026-08-10

> **Setup guide:** [Collections in the cell, and tasks that catch up](https://receptron.github.io/mulmoterminal/guide/en/v4.8.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.8.0.html))

**The visible half of the collection-project work, plus a scheduler that stops losing runs.** 4.7.6
taught the collection engine to resolve a root per request; this release puts that on screen as a
**Collections pane per cell**, scoped to the directory that cell is open in. Separately, built-in
scheduled tasks now persist their runs and catch up at startup, which is why a dev worklog someone
enabled could go for days without producing a page.

> **Do not put a collection in a project folder yet.** The per-folder feature is **not finished** —
> keep collections in the workspace. Missing: **scheduled refresh for a project's collection** (§3.5
> below — written and reverted, because an agent-ingest refresh scheduled for a project would have
> written into the *workspace's* same-named collection), **phone access** to a project's collection
> (no picker there), **two projects' cards in one panel** (needs an unreleased
> `@mulmoclaude/collection-plugin` built against core 3.1.0), and **a live browser check of the
> pane**. Nothing here affects a collection already in the workspace.

### A Collections pane per cell, scoped to its directory ([#1573](https://github.com/receptron/mulmoterminal/pull/1573))

The pane sits in the cell's right-pane selector beside Canvas / Tools / Files and lists the
collections of that cell's folder. **No project picker is needed** — a Project *is* a directory
(`plans/project-architecture.md` D2) and a cell already names one.

Navigation is contained in the pane. The collection plugin's views navigate through one global
binding, which until now meant "the full-screen overlay", i.e. the app's route: left alone, a click
in a side pane would have moved the whole app, and two cells on different projects would have shared
one "open collection". `collectionNavSurface.ts` is a stack of surfaces mirroring the teleport-target
stack beside it and for the same reason — surfaces nest, so the innermost wins and unregistering
restores the previous.

### Per-root watchers and project-aware completion bells ([#1580](https://github.com/receptron/mulmoterminal/pull/1580))

The completion watcher mounted ONE generation, for the workspace, so a collection in a project folder
got **no completion bells and no live refresh** when an agent wrote a record directly — the canonical
authoring path. core 3.1.0 supports a generation per root concurrently; this wires one per root the
server serves: the workspace plus every saved `cwdPresets` directory. **"Open" means "served by this
server", not "on screen"** — a saved directory is watched whether or not a cell shows it.

Also fixes the pane button showing on a cell whose directory has no collection tools.

### "Would this collection survive a clone?" ([#1582](https://github.com/receptron/mulmoterminal/pull/1582))

`GET /api/collections/:slug/self-containment`, project-scoped like every other read. Five rules, each
named for what breaks on the **other** machine: `user-scope` (the skill is in `~/.claude/skills`, so
the clone gets whatever that machine has) and `data-ignored` (schema committed, records gitignored —
reads as an empty collection) and `sqlite-store` (one binary file git cannot merge) are blockers;
`csv-runtime` (the file travels, the DuckDB runtime must be there too) and `no-primary-key` (4-byte
random ids, so two machines can mint the same one) are warnings; `not-a-repo` is informational.

§3.5 of the handoff plan was attempted in the same branch and reverted.

### Staging is workspace-only, and the agent is told so ([#1578](https://github.com/receptron/mulmoterminal/pull/1578))

Takes `@mulmoclaude/core@3.1.0`. `skillsStagingDir` returns the staging path for the managed
workspace and **`null`** for every other root. Staging exists to route around the `.claude/`
permission gate: the agent writes drafts to a plain data dir and a bridge mirrors the allowlisted
files across. A project folder has **neither gate nor bridge**, and the engine reads staging *first*
for a project-scope collection — so a stray `data/skills/<slug>/` shadowed the committed skill in a
repo whose whole point is to be self-contained. `manageCollection`'s `schemaDocs`, which the agent
reads before authoring, now says which directory to write in for which scope instead of an
unconditional "author under `data/skills/<slug>/`".

### A `presentCollection` card fetches its own session's project ([#1579](https://github.com/receptron/mulmoterminal/pull/1579))

Reported from a real session: an agent in a project folder created a collection there successfully —
`putSchema` wrote it, `queryItems` read 168 records — and `presentCollection` then rendered
**"Collection not found"**. The tool call succeeded and the card failed, which is the worst shape for
this to take. The card self-fetches by slug through the global binding, which scopes to the active
surface; with no Collections pane open there was no surface, so the fetch went to the workspace. The
canvas is a surface too and now says so: it shows one session's cards, that session has a directory,
and that directory is the project its cards belong to. It registers with a project and **no `nav`**,
a new shape the surface stack allows.

### Scheduled tasks catch up after the server was off ([#1583](https://github.com/receptron/mulmoterminal/pull/1583), fixes [#1581](https://github.com/receptron/mulmoterminal/issues/1581))

System tasks (dev worklog, feed refresh, calendar sync) were registered directly on the task-manager,
which fires an interval schedule only on UTC-midnight-aligned boundaries. A 6-hour task could
therefore run only during the one tick minute at 00/06/12/18 UTC, and a server that was off, asleep
or restarting through that minute skipped the run **forever** — nothing recorded that a window had
passed, and nothing in the UI or API could say so.

They now go through `@mulmoclaude/core/scheduler`'s persistence adapter, the same path MulmoClaude
uses: `config/scheduler/state.json`, startup catch-up per each task's `missedRunPolicy`, and an
execution log under `data/scheduler/logs/`. The worklog uses `run-once`, because its own window is
`[lastRunAt, now]` — one catch-up run already covers everything missed, and `run-all` would spawn
several batches summarising the same period.

**A task the state file has never seen is seeded at boot**, which is not something MulmoClaude does:
`computeCatchUpPlan` reads a missing entry as "just registered" and enumerates nothing, and because
nothing is then written the next boot reads it the same way — the reported bug surviving its own fix.
The seed writes `lastRunAt` with `totalRuns: 0`, so nothing claims a run happened, and it lands
before `initScheduler` because the adapter holds the state map in memory and rewrites the whole file
on each save.

User tasks still fire forward only (as in MulmoClaude), but every run is now recorded with the
turn's **real** outcome rather than "the spawn returned" — MulmoTerminal has the same completion-hook
seam MulmoClaude uses, so a scheduled chat that dies on its first turn is filed as a failure.
`spawnScheduledWorker` gained an `onComplete` hook for it; the hook map holds one hook per session,
so the recorder shares the existing failed-worker hook rather than replacing it. Two read-only routes
report all of it, shaped like MulmoClaude's `schedulerTasks.ts`: `GET /api/scheduler/tasks` (system
and user tasks, each with `origin` and execution state) and `GET /api/scheduler/logs`
(`since` / `taskId` / `limit`, capped at 500).

The tick loop deliberately starts **before** the adapter has registered its tasks. Both orderings
lose something and they are not symmetric: a user task is one-shot — "remind me at 09:00", with no
catch-up in either host — so a tick it misses is a reminder that never happens, while a system task's
work survives a missed run (the worklog's window is `[lastRunAt, now]`, feeds dedup on
`lastFetchedAt`, calendar on `lastSyncedAt`).

### Documentation

- **Two guide screenshots retaken, and every image indexed** ([#1410](https://github.com/receptron/mulmoterminal/pull/1410)). `cockpit-roster.png` showed a maintainer's real instance — project names in the roster, real PR numbers in the enlarged pane — and `grid-cell-live.png` caught Claude Code's startup banner with an account email. Both retaken on 4.7.5 with the same framing (the live-cell shot narrowed to a header close-up, since its job is to make the two cost badges readable), and `docs/guide/images/README.md` now indexes all 74 images.
- **4.7.6 release notes and setup guide** ([#1577](https://github.com/receptron/mulmoterminal/pull/1577)).

## mulmoterminal@4.7.6 — 2026-08-09

> **Setup guide:** [Groundwork for collections outside the workspace](https://receptron.github.io/mulmoterminal/guide/en/v4.7.6.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.6.html))

**An infrastructure release.** No screen changes, no setting is added or removed. The work is in the
collection engine's root handling: it assumed one shared workspace and now resolves a root per
request, which is the groundwork for a collection living in any project directory rather than only
in the workspace. The client half — the UI that would let you pick a project — is not built, so
nothing in the browser sends a project yet.

### Collections can be served from any known project ([#1572](https://github.com/receptron/mulmoterminal/pull/1572))

A request may name a project with `?project=<opaque id>`, and the collection routes serve **that**
root instead of the shared workspace. Absent the parameter, everything behaves exactly as before.

The id is the security boundary. It is **opaque** and resolved against directories the app already
knows — the workspace plus the saved `cwdPresets` — because the engine's `resolveDataDir` guarantees
containment only *within the root it is handed*, so the root itself must not be attacker-controlled;
a path parameter would have turned every collection route into an arbitrary-directory reader.
Deriving the id from the path (a truncated digest) also keeps host paths out of the browser, out of
URLs and out of logs, and needs no registry, since the list of projects is already `cwdPresets`.
`GET /api/collection-projects` lists what a request may name — deliberately **outside**
`/api/collections/*`, both because MulmoClaude's `apiRoutes.ts` is the naming authority there and
has no project concept to match, and because it would shadow `/api/collections/:slug` for a
collection someone named `projects`.

A slug is unique only *within* a root, so everything keyed on one alone was re-keyed by
`(root, slug)`:

- **View tokens** carry the root and are checked against the root the request resolves, so a `tasks`
  token minted in one project is unusable against another project's `tasks`. The minted `dataUrl`
  carries the project too — the iframe fetches it verbatim, and a URL without it would resolve to
  the workspace, against which the token is invalid, rendering an empty 401 instead of the records.
- **The thumbnail cache** keys on the root. Two projects both holding `data/pic.png` is the normal
  case, and the cached value is the image **bytes** — a path-only key served one project's picture
  inside another's view.
- **The view-query concurrency cap** keys on the root, so one project's dashboard cannot spend
  another's budget.

An unknown project answers **400**, not 500 — a typo in a query parameter is the client's error —
and **401** inside the view-token middleware, where a request whose root cannot be resolved has no
valid token by definition. `test/server/backends/collectionsProjectScope.spec.ts` is the assertion
the previous architecture could not express: two roots, each owning a `tasks` collection, read and
written through the same routes without bleeding into each other.

### A root is resolved per request, and the engine is left none ([#1571](https://github.com/receptron/mulmoterminal/pull/1571))

Behaviour unchanged — every request still resolves to the shared workspace — but
`configureCollectionHost` now binds `workspaceRoot: null`, so `getWorkspaceRoot()` **throws** instead
of guessing, and every engine call names its root through the new `server/infra/project-root.ts`:
one choke point, so serving a second root changes one function rather than the ~30 call sites this
touched.

The ceremony for a no-op is the point. With one root, a forgotten `opts.workspaceRoot` resolves
correctly by accident; with one root per project it is not a crash but a read or write of another
project's data, with tests green, types green and nothing logged. Turning the fallback into a throw
is the only way to know the threading is complete — and it immediately caught two missed call sites:
the custom-view i18n read, and the thumbnail resolver's containment check, which is a security
boundary and must check against the root the request resolved rather than whatever happened to be
bound.

Shapes worth knowing: injected-dep modules are bound per scope (`buildRemoteViewFor(scope)` and
friends) so no dep interface changed; `manageCollection`'s binding takes the root as a **getter**,
since the tool is built at module scope before boot binds anything; the completion watchers are
started with an explicit root, because without one they would throw `COLLECTION_ROOT_REQUIRED` on
first discovery into a fire-and-forget `.catch` and leave every collection bell silently dead; and
`resolveProjectRoot` **refuses** a `?project=` parameter rather than ignoring it, since ignoring it
would serve one project while the client asked for another.
`test/server/infra/projectRoot.spec.ts` pins the throw — binding a string root again would restore
the silent fallback and every other test would still pass.

### `@mulmoclaude/core` 3.0.0, then 3.0.1 ([#1570](https://github.com/receptron/mulmoterminal/pull/1570), [#1576](https://github.com/receptron/mulmoterminal/pull/1576))

Core 3.0.0 is the release that makes the collection engine safely multi-root (a host may bind
`workspaceRoot: null` and pass an explicit root per call). No MulmoTerminal source changes were
needed for the bump itself; 3.0.1 is a follow-up patch.

The bundled plugins moved with it because a caret does not float across a major: left alone, six of
them would have pulled a **nested `core@2.x`** beside the top-level 3.0.0 — and since `html-plugin`,
`markdown-plugin` and `accounting-plugin` import `@mulmoclaude/core/plugin-vue`, the bundle would
have carried **two copies of a Vue-side runtime**, which is how a plugin registers into one copy
while the host reads the other. Verified as exactly one copy of core in `node_modules`. Two breaking
changes were absorbed with no source change: `isContainedInWorkspace` was removed from
`@mulmoclaude/core/collection/server` (zero callers here), and `CollectionHost.workspaceRoot` widened
to `string | null` (we pass a string).

Also landed with that PR are the design notes the work runs on: `plans/project-architecture.md` — a
Project is an existing directory rather than a new abstraction, and collections / accounting / wiki /
resources are **one** problem, a boot-time root binding that wants to be a per-request root resolver
— and `plans/feat-collections-project-root.md`, the consumer-side plan.

### Documentation ([#1569](https://github.com/receptron/mulmoterminal/pull/1569))

The 4.7.5 changelog entry and the dated `docs/guide/{en,ja}/v4.7.5.md` setup guides, merged after
that release's tag.

## mulmoterminal@4.7.5 — 2026-08-09

> **Setup guide:** [Settings you can find, in a language you read](https://receptron.github.io/mulmoterminal/guide/en/v4.7.5.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.5.html))

**A release about Settings.** It had grown to twenty-four headings in one scroll, all of them in
English, with a button that started a live agent session the moment it was pressed. Three reports
about the same screen, all from the same week.

### Settings is a sidebar of grouped sections, not one flat scroll ([#1563](https://github.com/receptron/mulmoterminal/issues/1563), [#1565](https://github.com/receptron/mulmoterminal/pull/1565))

Twenty-four headings stacked in a single 560px-wide scroll, with no grouping, no search and no table
of contents. "Notification sounds" was the eighth heading down, and the report that opened #1563 is
someone who went looking for it and gave up.

It is now a left sidebar of **nine groups** — Appearance, Projects, Header & launch, Input, Models &
servers, Notifications, Integrations, Sessions, Help — with one section on screen at a time,
following MulmoClaude's own settings sidebar so a user of both gets the same shape.

Two things were done differently from that reference, because twenty-four entries is not fifteen:

- **The sidebar is a real `role="tablist"` with roving tabindex.** Twenty-four plain buttons would
  be twenty-four Tab stops standing between the dialog and the setting it was opened for — more
  keystrokes than the flat scroll being replaced. Only the selected tab is tabbable; arrows move
  within the list and wrap.
- **Below `sm` the sidebar becomes an `optgroup`'d picker above the section.** Captured at 390px, a
  160px sidebar left about 190px of pane and the notification-sound rows lost their own labels off
  the left edge.

A pane is **created the first time its tab is opened and hidden afterwards, not destroyed**. Opening
Settings for one setting no longer mounts twenty-three sections and fires their requests, while a
value typed but not yet applied — the terminal font field keeps one in a local draft precisely so a
failed save does not lose it — survives a trip to another section and back.

`ShortcutsSection` carried two headings and became `Terminal keys` and `Keyboard shortcuts`: two
sidebar entries are two chances to find the thing. `Voice input`'s server capability probe moved up
to the modal, since a section that hid itself inside a tab would leave an empty pane behind a button.

### Settings speaks Japanese ([#1566](https://github.com/receptron/mulmoterminal/issues/1566), [#1567](https://github.com/receptron/mulmoterminal/pull/1567))

MulmoTerminal had **no host i18n at all**. `vue-i18n` was in `package.json` only because the bundled
`@mulmoclaude/*` plugins run their own; `createI18n` and `useI18n` appeared nowhere in `src/`,
`server/` or `common/`, and every string in the app was hardcoded English. That is the other half of
#1563: a Japanese reader searching the screen for 「音」 or 「通知」 found no such word on it.

- `src/i18n/` holds `createI18n({ legacy: false, fallbackLocale: "en" })`, installed in `main.ts`,
  with `en` and `ja` bundles. **`ja` is typed from `en`**, so a key added to English is a compile
  error until it is translated rather than a silent fallback discovered a release later.
- `src/composables/uiLanguage.ts` is `"auto" | "en" | "ja"`, localStorage-backed like the theme.
  `auto` — the default — resolves through the existing `browserLocale()`, so a `ja-JP` browser comes
  up Japanese with nothing configured.
- A **Language** tab leads the sidebar. It is first on purpose: it is the one setting someone who
  cannot read the rest of the screen has to find first.
- Every string in the modal is translated, `aria-label`s included, and `settingsTabs.ts` now holds
  ids only — the words are `settings.tabs.<id>` and `settings.groups.<key>`, derived the way
  MulmoClaude derives its own.

**Only the Settings modal is translated.** Every other surface is still English and moves later, one
at a time; the Language pane says so on screen rather than leaving a user to wonder.

### A skill button says what it does, and can be cancelled ([#1564](https://github.com/receptron/mulmoterminal/issues/1564), [#1568](https://github.com/receptron/mulmoterminal/pull/1568))

A skill button was an icon and a label. Pressing "Configure notifications…" closed Settings, spawned
an agent session in a new grid cell and sent its first turn — nothing on screen said that would
happen, and nothing said how to undo it. The report is someone who decided they did not need the
setting after all and could not find the way back.

- **A one-line hint under every skill button**, saying an agent does the writing.
- **A confirmation on press**, with Cancel / Start. It names the agent the launcher is set to — not
  a hard-coded `claude`, since the seed is rewritten server-side for codex — says one new terminal
  will open, and says that closing that terminal ends the session.
- **Cancel leaves Settings exactly where it was.** Previously `closeSettings()` ran first, which is
  why there was nothing to go back to; `launch-skill` now fires only on Start.
- `Escape` answers the confirmation first and reaches the modal only on a second press. The
  confirmation is owned by the modal rather than by the button for exactly this reason:
  `useModalKeyboard` binds Escape on the document, so a dialog with its own binding would close both
  on one press.
- Declining returns focus to the button that raised it, found by the **skill it launches** rather
  than by remembering `document.activeElement` — a browser does not reliably focus a `<button>` when
  it is clicked, and Safari does not.

## mulmoterminal@4.7.4 — 2026-08-08

> **Setup guide:** [Your projects, recognisable on your phone](https://receptron.github.io/mulmoterminal/guide/en/v4.7.4.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.4.html))

**A release about the phone.** The picture that tells your projects apart in the grid now tells
them apart on your phone too, and an agent you launch from the phone finally starts instead of
waiting for someone at the desktop.

### A project's icon now reaches the phone ([#1556](https://github.com/receptron/mulmoterminal/issues/1556), [#1558](https://github.com/receptron/mulmoterminal/pull/1558))

The image a directory marks its cells with — `icon` in its `.mulmoterminal.json`, or the favicon
its repository already ships (4.5.0) — now appears in the mulmoserver PWA's **terminal list** and
**terminal screen**, so one project reads as one project on both screens. On the list it takes the
place of the terminal glyph; that glyph's green/grey was the only thing saying whether a session is
live, so the colour moved to a dot on the icon's corner rather than being dropped. A row whose
directory has no icon keeps the glyph.

The browser fetches `/api/dir-icon?cwd=…`. The phone has no route to this host at all — it speaks
over Firestore command documents — so the picture travels **inside the reply** instead:
`listTerminalSessions` gained an `icons` table that rows point into by `iconId`, and
`getTerminalScreen` gained an `icon` holding the src directly. A remote `http(s)` or `data:` icon is
passed through as written; a file inside the project is read and inlined as `data:<mime>;base64,…`.

`iconId` is a **content hash**, so the six clones of one repository — and the nine that share a
copied `public/favicon.ico` — send those bytes once between them. Two caps keep the reply landing:
48 KiB per image, 256 KiB for the table. The second is the one that matters, because the reply is a
Firestore command document that rejects the *whole* document over 1 MiB — an unbounded pile would
empty the phone's session list rather than dim one row, the same failure as
[#1042](https://github.com/receptron/mulmoterminal/issues/1042). Icons are packed in the order the
phone shows the rows, so a budget that runs out costs the bottom of the list. Both numbers come
from measurement rather than guesswork: across the 22 repositories on the author's machine that
carry a detectable icon, the largest was 25931 bytes, the median 4286, and all 22 together come to
148 KB of base64 — nothing reaches either cap.

Two hardenings came out of review, both of which stand on their own. `readIconFile` now **reads no
more than the cap**, so the cap is a fact about the returned buffer rather than a claim about the
file: `stat` then `readFile` was neither, since a file in someone else's repository can become
something else between the two calls. And it opens with `O_NOFOLLOW | O_NONBLOCK` and `fstat`s the
descriptor, which refuses a FIFO left where the icon was — that would otherwise make `open` wait
for a writer and stop this synchronous handler, and the server with it.

Needs the companion UI, [receptron/mulmoserver#144](https://github.com/receptron/mulmoserver/pull/144),
which is already deployed.

### A phone-initiated agent launch now actually starts ([#1535](https://github.com/receptron/mulmoterminal/issues/1535), [#1557](https://github.com/receptron/mulmoterminal/pull/1557))

Launching `claude` or `codex` from the phone opened a cell on the desktop grid and stopped at the
**empty cell-creation form** — agent pre-picked, directory filled in, waiting for someone at the
desktop to press Start. `shell` worked; the others did nothing if left alone.

The grid was what was wrong, not either host: a cell with no session, no command and no launcher
**is** the empty launcher (`isLaunchCell()` says so, and `TerminalCell` renders `CellLaunchForm`
whenever it mounts without a session id) — and that is exactly what `CELL_FOR_AGENT` built for every
agent kind. A one-shot, ephemeral `Cell.autoStart`, consumed by `TerminalCell` on mount, is the
missing way for the grid to say "this cell already knows what it runs; start it". It counts as
occupied while the session id is still on its way, so `switchPage` does not mistake a trailing cell
for an abandoned launcher and `+` does not cancel it, and `setSession` strips the key once the id
lands. Giving the agent cells a `launcher` instead was rejected: that runs the user's command
verbatim on the launcher PTY with no MCP config, which is exactly the line CLAUDE.md draws between a
launcher chip and an agent spawn.

### Codex session discovery stops re-reading tens of megabytes a second ([#1554](https://github.com/receptron/mulmoterminal/issues/1554), [#1555](https://github.com/receptron/mulmoterminal/pull/1555))

A JSONL file is one JSON object per line, but `readSessionMeta` stringified the **whole** codex
rollout to read its first line (`session_meta`). Its caller, `pickFreshSession`, polls once a second
for up to thirty minutes over every rollout from the last two days — measured on the reporter's
machine at **149 files and 37 MB re-read every second** to look at a few hundred bytes. It now reads
the first line only, through the reader module written after
[#998](https://github.com/receptron/mulmoterminal/issues/998), which had line-streaming, tail and
range reads but no "first line only" until now.

**Not an OOM fix.** The crash reports under investigation are all `FatalProcessOutOfMemory`, and a
rollout caps out at 6 MB, so this path alone cannot reach the 4288 MB heap ceiling. The root cause
is still being chased; this is a real waste found along the way.

### Also

- **Dependency refresh** ([#1559](https://github.com/receptron/mulmoterminal/pull/1559)). No
  behaviour change.
- **The 4.7.3 release documentation** ([#1553](https://github.com/receptron/mulmoterminal/pull/1553))
  — changelog entry, the dated setup guide in both languages and three screenshots — which landed
  after 4.7.3 was tagged and so falls in this range.

## mulmoterminal@4.7.3 — 2026-08-08

> **Setup guide:** [Buttons that say they are working](https://receptron.github.io/mulmoterminal/guide/en/v4.7.3.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.3.html))

**A release about controls that do not say they are working.** A button that shells out to git runs
for seconds on a large repository while the screen stays byte-identical to the moment before the
click — so it gets pressed again, and on `+ New worktree` every extra press *succeeded*. Alongside
it, pressing Enter now takes a scrolled-up terminal back to the latest output.

### `+ New worktree` made one worktree per click ([#1549](https://github.com/receptron/mulmoterminal/issues/1549), [#1550](https://github.com/receptron/mulmoterminal/pull/1550))

`git worktree add` checks out the whole tree — about six seconds on the reporter's ~33,000-file
monorepo. For all six the launcher looked exactly as it had before the click: no spinner, and the
button's only `disabled` test was "is the task field empty", with the field cleared *after* the
response landed. `uniqueBranch` takes the next free suffix, so three presses made
`agent/<task>`, `-2` and `-3` — three copies of one working tree.

The same line hid failures: `if (!res.ok) return;` plus an empty `catch` meant a 500 showed nothing
at all. The reporter's actual cause was a base branch that did not exist locally, and reaching that
diagnosis required reading the shipped bundle.

- **One guard for the whole worktree section** (`useBusyAction`), because they all run git in one
  repository where a second command contends on the index lock: the create, each worktree row
  (which waits on up to four `claude mcp add` calls before the cell launches), and each row's
  delete button. Whichever control was pressed shows `progress_activity` and a `Creating…` /
  `Removing…` label; the rest are held.
- **A refusal now says why**, in the server's own words — `{ error }` from the create route,
  `{ ok:false, reason }` from remove — the treatment the folder button got in #1447. The task name
  is kept for the retry.
- **The failure is scoped to the repository it was about.** The directory field stays editable for
  the whole round trip, so a refusal that lands after the user has typed their way elsewhere is no
  longer shown under the new directory.
- **A timeout is reported as a timeout.** `fetchWithTimeout` gives up at 60s while git carries on,
  so "could not reach the server" sent people to look at their network for a worktree that was
  about to appear.
- **An unreadable `200` body is a timeout too, not "the server created nothing."** The deadline
  stays armed across the body, and `jsonBody` absorbs an unreadable one into `{}` — the trap its
  own documentation names from #1300.
- **The running cell's `Discard & remove`** runs through the same guard, and **nothing dismisses the
  confirmation once the removal starts**: the terminal is ended before the route is even called, so
  "Keep worktree" was a promise the cell could not make, and Escape took the failure off the screen
  with it.
- Disabled styling on `wt-start` / `wt-del`, so a button that cannot be pressed no longer looks
  like one that can.

### A cell being removed now looks like it ([#1551](https://github.com/receptron/mulmoterminal/issues/1551), [#1552](https://github.com/receptron/mulmoterminal/pull/1552))

The fix above put `Removing…` on a 12px label inside a dialog, while the cell around it — header,
chips, terminal — went on looking live for the seconds `git worktree remove` takes. The whole cell
now fades through the same class parked cells use (which rides on `.cell-inner` and therefore covers
the header), with one spinner over it naming what is going. The spinner is a **sibling** of that
layer, not a child, so it is not dimmed by what it is dimming. The cell is also made `inert`, so it
cannot be reached by keyboard or read by a screen reader while it is being deleted — measured in a
real browser: 13 focusable controls before, 0 during. The confirmation is replaced rather than faded,
and comes back with its reason if the removal fails.

### Enter returns a scrolled-up terminal to the latest output ([#1546](https://github.com/receptron/mulmoterminal/issues/1546), [#1547](https://github.com/receptron/mulmoterminal/pull/1547))

Scrolling up in a Claude Code cell and pressing Enter left you where you were — unlike an ordinary
terminal, and unlike a **shell** cell here, which was the asymmetry that diagnosed it. Measured with
`tmux list-panes`: Claude Code runs mouse tracking 1003 on the alternate buffer, so tmux forwards
the wheel to the application and the scroll position belongs to Claude Code, with nothing on this
side to send back down (a plain terminal does not return either — the reporter confirmed it in
iTerm).

What is possible is **unwinding the scrolling this app itself synthesised** (#737 / #845): the
notches `report()` sent are counted and the same number is sent back down on submit. Scroll nowhere
and not a byte is sent. Clamped at zero so it can never scroll past the application's own bottom,
and forgotten rather than paid back once the application stops taking the mouse, so a later app does
not receive someone else's scrolling. **On by default**, with a per-browser checkbox in Settings →
Terminal scroll speed.

## mulmoterminal@4.7.2 — 2026-08-08

> **Setup guide:** [The terminal comes back on the right process](https://receptron.github.io/mulmoterminal/guide/en/v4.7.2.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.2.html))

**A reliability release built around one bug**: a terminal view could reattach to the *wrong*
backend process. Found on a live instance, traced through five pull requests, and each layer of it
fixed with the evidence the server already keeps rather than a new metadata store.

Alongside it: worktrees stop piling up as working-directory chips, the cockpit roster gets the
Agent Picker's marks and one border geometry, collection chats can choose their agent again, and
the Windows CI that #1534 turned red is green.

### The reattach chain (#1533)

- **Resume under the key the conversation is RUNNING under** (#1534): the launcher's resume row
  emitted the row's own id — the agent's conversation id — even when the server had already said
  (via `runningKey`, #1467) that the conversation was still running under a different, minted key.
  "Resume it here" then spawned `codex resume <conv>` in a fresh tmux session while the original
  kept running the same rollout, and a cold reconnect could come back on either. `dirSession` also
  gained a **survivor pass**: sessions in `runningSessionKeys()` that `ptys` no longer knows, tied
  back to their directory through the codex/agy/muse conversation logs — without it a worktree with
  a live backend read as free, so the one-session-per-worktree refusal (#1207) stopped firing.
  A Claude transcript whose session survives in tmux is likewise ranked live, so the running
  conversation outranks a merely newer transcript. `ptySpawn` now refuses a session id
  `SESSION_ID_RE` rejects at the one choke point every spawner passes — a live `mt-undefined` was
  found on a machine, a shared bucket unreachable by attach, resume and terminate alike — and the
  idle sweep reaps such an unreachable session at once rather than waiting out a grace no recency
  can satisfy. Also in this PR: per-session-id connect serialization, a re-read of the live entry
  after the admission awaits (the resolve-time snapshot can be a corpse the reap killed
  mid-admission), an endpoint/agent assertion for a live PTY, watcher guards for the muse and codex
  spawn attribution, and the client-side slot-inheritance guard that stopped a reloaded GridView
  handing a Claude cell a closed shell cell's ghost slot.
- **Codex activity re-armed on a restart reattach** (#1538, from #1536): after a server restart
  `ptys` is empty while tmux still holds the session — the state every bare `!live` test misreads
  as a fresh spawn. A tmux attach of a surviving codex took the fresh branch, whose watcher waits
  for a **new** rollout file to appear; the survivor's file already existed, so nothing tailed it
  and the cell's working/waiting flags — and its turn-finished notifications — stayed dead until a
  cold restart. The spawner now tails the hydrated mapping's rollout from the end, with no resume id
  so no second codex starts beside the surviving one, and falls back to the appear-watcher for a
  survivor that never reached its first turn. `restoreOpenTurn` re-reports a turn the skipped
  content leaves open, so a mid-turn survivor is not shown as idle until its turn ends. The codex
  directory tool-group read now uses the session's own cwd (`sessionCwd`), since a restart reconnect
  often carries no `?cwd=` and answered for the default workspace. And claude — the one agent
  endpoint that never asked — got the `clientStillConnected` guard after its admission awaits.
- **A provably foreign tmux survivor is refused at the endpoint** (#1541, from #1537): the
  endpoint/agent mismatch check added in #1534 needs a live `PtyEntry` to compare against, so after
  a restart it had nothing — and `tmux new-session -A` attaches whatever runs in the pane while
  **ignoring** the argv the endpoint's spawner built, after which the recreated entry records the
  *endpoint's* agent. Stale or coerced grid state (`asTerminalAgent` reads any unrecognised value as
  `claude`) could therefore relabel a surviving codex as claude, and every later same-process guard
  would trust the label. A new guard in `admitAgentSession` — the shared choke point for the claude,
  launch, codex and directory-MCP endpoints, before the browser is told a session id — decides from
  what an agent left durably under the session's own key: a claude transcript, codex's rollout
  mapping, agy's and muse's hydrated conversation maps, a grok conversation named by the key. A
  single piece of foreign evidence is a loud refusal; **no** evidence attaches as requested, because
  a shell survivor and an agent session that never reached its first turn both leave none, and
  refusing the unknowable would lock users out of legitimately surviving sessions.

### Working directories

- **A worktree is no longer remembered as a WORKING DIRECTORY chip** (#1543, fixes #1542): the chips
  are auto-recorded from wherever a cell launched, and a worktree launches like anywhere else — so
  every isolated task left one behind, for a directory that is one branch for one task and is
  deleted with it. Nothing pruned the chip when the directory went, either (the close button is the
  only remover), so the row filled with paths that no longer exist and pushed the real projects out
  of reach. Both recording paths are covered — the browser's `recordPreset` and `deriveCwdPresets`,
  which reseeds the list from Claude's history on `mulmoterminal init` — through one predicate in
  `common/worktreePath.ts`. It is anchored on the managed **root** (`GET /api/config` now reports it
  beside `home`, canonicalized, since the browser cannot work it out and `MULMOTERMINAL_HOME` can
  move it) and requires the minted `<repo>-<8hex>` directory, so a path another tool laid out the
  same way — or one a person put under the root by hand — is still recorded. An unknown root records
  the directory: of the two ways to be wrong, an extra chip the user can delete beats a real working
  directory that quietly never appears. Entries already saved are left exactly where they are.
- **One file dialog at a time** (#1528, fixes #1527): clicking the folder button repeatedly opened
  one native OS dialog per click, because a native dialog does not answer until it is dismissed and
  `/api/pick-file` spawns `osascript` / `powershell` / `zenity` per request with nothing stopping
  the clicks in between. There is one OS dialog per machine, so the state behind it is now one
  shared module flag every picker button reads, and the server refuses a second concurrent dialog
  too.

### Cockpit roster

- **The picker's agent mark on every row, and none on a row that runs no agent** (#1532): the row
  wore a non-Claude agent's **name** in a bordered pill (`codex`, `agy`, `grok`, `mu`); it now wears
  the same drawn mark the Agent Picker and the rate-limit gauge use, so one agent looks the same
  wherever it is named. Marking every row makes the default visible, which is where the trap was:
  `Cell.agent` is absent for Claude **and** for every cell that is not an agent session at all, so
  `c.agent ?? "claude"` would have put Anthropic's burst on a `yarn dev` chip. `rosterAgent()` asks
  the cell's kind first — a launcher or command cell is `shell` whatever command line it names, a
  session cell keeps its agent, and a cell running nothing is marked with nothing at all.
- **One border geometry for every row, and a louder cursor** (#1531): the outer ring was 2px for
  `blocked`, 1px for `done` and absent for the other three states. In a vertical list the eye reads
  the difference in **width** before the colour, so three thicknesses read as a rendering bug rather
  than three meanings. Every state now rings at 2px — `transparent` where there is nothing to say —
  as a box-shadow, so the geometry is identical and costs no layout. The 3px left stripe, carried
  without a reason since the roster's first prototype, is gone: once the ring surrounds the row it
  only made one side disagree with the other three. Row spacing went 5px → 9px, since neighbouring
  rings had closed to within a pixel and the column read as one block.

### Collections

- **Choose the agent for a collection chat, and workspace skills on all of them** (#1544): chats
  started from Collections were Claude-only twice over. The three-button toggle had been replaced by
  the pinned favourites, leaving `launchAgent` with **no writer** — frozen at whatever localStorage
  last held, Claude for anyone who never used the old toggle. A compact "Launch with" dropdown now
  shares the row with the pins, offering the built-in agents and only those (`spawnBackgroundChat`
  hosts exactly them: no shell, since a seeded chat needs an agent, and no custom agents, since the
  route builds no custom argv), derived from `TERMINAL_AGENTS` so a sixth agent reaches the picker
  with no second list. The other half: the workspace skills those chats lean on were invisible to
  some agents, and every agent now sees them.

### CI and tooling

- **Windows CI restored** (#1540, fixes #1539): `main`'s Windows daily had been red since #1534's
  merge. `survivorCandidates` takes an already-canonical directory — `dirSession` hands it
  `canonicalPath(dir)` and the pass canonicalizes only the record's side — but the new spec passed a
  raw POSIX literal, so on Windows it compared `/wt/fix-login` against `D:\wt\fix-login` and
  nothing ever matched. Production code was correct; the spec was not. Worse, four of its six cases
  assert an empty result, so they had been passing on Windows for the **wrong reason** — the spec
  was effectively inert there. A case where the record spells the directory another way now pins
  that the comparison is real. Also adds the `settledEntry` refusal branch (the error frame that
  stops the client's reconnect loop) that #1534's review left uncovered.
- **Codex auto-review on the current CLI and model** (#1526, #1529): CLI `0.125.0` → `0.147.0` and
  the Azure deployment `gpt-5.3-codex` → `gpt-5.6-terra`, the balanced model of the current line;
  the old deployment stays for rollback. #1529 then folded in the review of that change — separating
  required secrets from optional overrides, recording that an override deployment name must still be
  one the CLI does **not** recognise as a model (a recognised name revives the namespaced tools
  payload and Azure fails every review with `400 empty_string`), and deleting an api-version note
  that contradicted the block above it.
- **dev.to cover image** (#1530): moved into this public repository, since the private marketing
  repo's raw URLs 404 from outside and the article's cover never rendered.

## mulmoterminal@4.7.1 — 2026-08-07

> **Setup guide:** [The version you are running, on screen](https://receptron.github.io/mulmoterminal/guide/en/v4.7.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.1.html))

**The app can now tell you which build it is**, which until now it could not: the only way to
answer "what am I running?" was `--version` in another terminal, and the header's Update badge
appears only when something newer exists — it never named the version you had.

Alongside it, the Agent Picker stops being six words in one weight, and two remaining ways a seed
prompt could kill a session are closed.

- **The running version, in Settings** (#1524): a **Version** row under the modal's title. An npm
  install shows the version from the shipped `package.json`; a git checkout shows that plus the
  short HEAD **commit**, because there the version is only whatever was last released and the
  commit is what identifies the build. When the registry has something newer, the row repeats the
  header badge's notice with its command — the badge is behind the modal while it is open. The
  update check was restructured to make this possible in one pass of the probes: `computeUpdateInfo`
  now returns the facts (`install` / `version` / `commit` / `latest` / `notice`) and
  `computeUpdateNotice` takes the notice out of it, so the launcher's console line is unchanged.
  `readInstallInfo` is the network-free half, which is what runs when the update check is opted
  out — `MULMOTERMINAL_NO_UPDATE_CHECK` / `NO_UPDATE_NOTIFIER` silence the *notice*, not the
  version display, and reading it never leaves the machine. `/api/update-status` gained `ready`:
  the old "notice is null" could not tell *up to date* from *the check has not finished*, which is
  harmless for a badge that draws nothing either way but would have left the commit permanently
  absent. The wire shape moved to `common/updateStatus.ts` and `useUpdateStatus` became a single
  module-level poller, since the badge and the version row are two readers of one answer.
  Requested by [@chikara813](https://github.com/receptron/mulmoterminal/issues/1520).
- **A mark per agent in the Agent Picker** (#1521): each built-in agent shows the shape it already
  wears in the rate-limit gauge — Anthropic's burst, Codex's crossed loops, Antigravity's
  four-point star, Grok's broken X, Muse's M — so an agent looks the same wherever it is named, and
  the marks inherit `currentColor` so the selected row's mark brightens with its label. The two
  options that are not agents get a Material Symbol instead: **Shell** a terminal, and a custom
  agent a slider — deliberately not Claude's burst, since a row indistinguishable from the Claude
  row is the problem being fixed. The label moved into its own span, because a Material Symbol is a
  ligature and its name is real text inside the button.
- **A seed prompt too long for the command line goes to a file** (#1522): `tmux new-session -A … --
  <bin> <args>` refuses a command line past a limit shared by everything on it, and over that limit
  tmux answers `command too long` and **the session dies** — a worse failure than the Windows one,
  and not Windows-only. Measured on tmux 3.7b: one 16,375-byte argument fails, and two 10,000-byte
  arguments fail together, which is what makes the budget the whole line rather than one argument.
  A seed over **4,096 bytes** now goes to a file on every platform. Measured in **bytes**, not
  characters: tmux counts bytes and Japanese is three per character, so 2,000 Japanese characters
  (6,000 bytes) goes to a file while the same count of ASCII does not.
- **A multi-line seed prompt no longer breaks Windows launches** (#1519): `grok`, `antigravity` and
  `muse` put the seed straight on the command line, and `codexifySkillSeed` always produces
  multiple lines — so on a `.cmd` install, launching any of the three with a skill failed with
  `UnsafeArgumentError` every time. The seed is written to a file and the command line carries one
  line naming it. Narrowed to the case that cannot work otherwise: non-Windows is unchanged, and so
  is a single-line seed on Windows. Same bug family as 4.7.0's `--append-system-prompt` fix.
  Reported by [@chikara813](https://github.com/receptron/mulmoterminal/issues/1518).
- **Two duplicate-code alerts closed** (#1525): the guards in front of a collection's record
  actions were copied between the parent route (`POST /:slug/items/:itemId/actions/:actionId`) and
  the view-token route (`POST /:slug/view-data/actions/:actionId`) — action 404, read-only 405,
  record 404 and the `actionVisible` 409. They are now one module, `collectionActionGuards.ts`,
  which is what stops the pair drifting into "the action pushed from a view has a different state
  gate". Behaviour is unchanged: same statuses, same wording, same per-route check order. jscpd
  reports 0 clones where it reported 2.

## mulmoterminal@4.7.0 — 2026-08-07

> **Setup guide:** [Muse, and the GUI tools it was not supposed to be able to reach](https://receptron.github.io/mulmoterminal/guide/en/v4.7.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.7.0.html))

**Muse is the fifth first-class agent, and its cells reach the GUI tools** — the thing the previous
release said was impossible. It was impossible only under a wrong premise: Muse does have MCP,
behind an experimental flag of its own, through a mechanism neither of the other agents uses.

With five agents in the picker, "which one, and what does it cost me" outgrew a table row, so the
guide gains a page for it. And on Windows, every Claude session can start again.

- **Muse as a first-class agent** (#1512): `muse` joins Claude / Codex / Antigravity / Grok in the
  Agent Picker with its own `/ws/muse` endpoint, spawner (`muse --yolo --workspace <cwd>`, resume as
  `muse resume <id>`), session discovery through its SQLite index, and a `mu` badge. The header
  carries the model and context the same way the other agents do, read from the session log's
  `model_completed` records: `Muse · ctx%` plus the token arrows. Point the CLI elsewhere with
  `MUSE_BIN`, override the model with `MUSE_MODEL`.
- **GUI MCP for Muse cells** (#1514): a Muse cell now gets the tool groups its DIRECTORY switched
  on. Muse takes neither a `--mcp-config` URL nor a per-directory config file, so this is a third
  route: MulmoTerminal registers ONE plugin holding all four group servers — `muse plugins install`
  records per MACHINE, so the registration cannot express "this directory" — and narrows each
  SESSION back to its directory's switches. Nothing reaches a plugin's MCP server but its command
  line (its environment is curated to 16 variables, all of Muse's own, and an `env` block in the
  manifest is dropped silently), so the group and port go in argv and the session is ASKED for:
  `POST /api/mcp-resolve` walks the bridge's process tree and matches it against `tmux list-panes`,
  which is exact enough to tell two Muse cells in one directory apart. A group the session is not
  entitled to serves an EMPTY toolset rather than an error, so a cell with one group on does not
  show three broken servers. Verified end to end against a real cell: exactly the four `render`
  tools, and a `presentChart` call writing a real chart into that session's workspace. The bug that
  hid all of it was a route collision — `POST /api/mcp/resolve` was swallowed by `/api/mcp/:sessionId`
  and answered `400`, which the bridge reads as "no session", so the feature failed by serving zero
  tools with nothing logged; the route is now `/api/mcp-resolve` and logs both outcomes.
  Requires Muse's own `MUSE_EXPERIMENTAL_PLUGINS=1`; without it a Muse cell still starts, with no
  GUI tools and one warning.
- **Muse review fixes** (#1513): a resumed session dropped `--workspace`, which is what registers
  the policy-gated workspace tools — the conversation came back without them. The context badge read
  a HIGH-WATER mark (`input_tokens` is the context a call ran with, not an increment), so it never
  came down after a compaction: `ctx 397k` against a live 266k, telling the user to `/compact` when
  they need not; it now reads the last completed call, which is what the codex and grok badges mean.
  The badge poll re-read the whole session log every time — 33 MB after a day, once per cell per
  minute — and now folds through `transcript-fold` as grok's does: 105 ms cold, 2 ms warm, with
  byte-for-byte the same totals. Every sqlite question was a full-table scan filtered in JS,
  including the spawn watcher that asks twice a second for 15 s; all are now `WHERE`-keyed. A claude
  cell paid for muse on every poll through a self-healing fallback that fired whenever a claude read
  came back empty — the normal state of every claude cell before its first turn. And muse looked up
  per-directory MCP config it cannot use, now gated by `readsDirectoryMcpConfig`.
- **A guide page for choosing an agent** (docs): **Which coding agent** covers all five —
  what each needs installed and its `*_BIN` / `*_MODEL` overrides, where its conversations live and
  therefore why only it can resume them, the three different routes to the GUI tools (a per-session
  URL for Claude and Codex, a file in the directory for Antigravity and Grok, a per-machine plugin
  for Muse) and why that is a property of each CLI rather than a setting, and what the header badges
  mean. It also covers the two things that widen what "Claude" means — a `providers` entry for any
  Anthropic-compatible backend, and a `customAgents` entry for your own way of starting Claude Code —
  and why a launch command is none of these. The Agent Picker row in Basics gains Muse and a link.
- **Windows: `appendSystemPrompt` no longer stops every Claude session from starting** (#1516,
  #1517): a Windows command line has no encoding for CR/LF/NUL — CR/LF end the line, NUL ends the
  string — so `escapeBatchArgument` refuses an argument carrying one rather than mangle it, and the
  default `--append-system-prompt` is a 44-line preset. A `.cmd`-installed Claude therefore could not
  be launched at all, on every session, since 2.3.0. There is nothing to escape it INTO: substituting
  the newlines away would hand the agent a different instruction, which is the exact failure the
  throw prevents. The repo already had the answer — `--settings` and `--mcp-config` travel as a PATH
  on Windows because "a path has no quotes and no metacharacters, which removes that layer rather
  than escaping through it" (#813) — and `--append-system-prompt`, added later in #942, was the one
  argument outside that rule. It now uses `--append-system-prompt-file` there; off Windows nothing
  changed. The stated reason for inline (a Docker sandbox that could not read a host path) had gone
  when that sandbox was removed in #1195. Orphan cleanup learned the new file: its name parser was
  `.json`-only, so a `.txt` would never have been swept. The Windows argv test now runs through the
  real cmd-escape rather than checking for quotes — #813 was a quote and #1516 was a newline in a
  flag added two years later, and a test that checks the characters it knows about only catches the
  bug it was written for. Reported by @chikara813, who identified the exact release that introduced
  it.
- **Collection documentation caught up with the code** (#1492, #1510): the places where
  MulmoTerminal's `/api/*` paths deliberately differ from MulmoClaude's are written down rather than
  left to be rediscovered. Documentation and comments only; no runtime change.

## mulmoterminal@4.6.1 — 2026-08-06

> **Setup guide:** [Rooms, and a grid that keeps up with a flood](https://receptron.github.io/mulmoterminal/guide/en/v4.6.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.6.1.html))

Two halves. **The conversation between cells now has somewhere to live**, and **a busy cell has
stopped slowing down the command it is showing.**

Round table (4.6.0) carried one cell's reply into the next cell's input box, and that was all it
was — the conversation existed while it ran and nothing held it. A **room** is that conversation kept
apart from the cells having it, so a person, a shell or a CI job can take part in something that
until now only cells could reach. The limit from 4.6.0 is unchanged and deliberate: no MCP tool, no
way for an agent to discover a room, no way for one to start a conversation. A human seats the cells.

The performance half is a single wrong complexity. `appendBoundedOutput` kept a session's replay
tail by slicing, which flattens, so **every chunk cost the size of the whole tail** — a megabyte of
copying for a few dozen bytes. That was 86% of a core during a flood, and it was CPU not being spent
reading the pty, so the child process waited for its own output to be collected. Six cells running
the same heavy command took 8.2 s; they now take 2.2 s, against a floor of 1.9 s for the six shells
with no app involved at all.

- **Rooms: an append-only log a conversation is kept in** (#1456, #1476): one file per room at
  `~/.mulmoterminal/rooms/<id>.jsonl`, one JSON object per line, plus the HTTP surface
  (`GET /api/rooms`, and `GET` / `POST` / `DELETE` on `/api/rooms/:room`) and a
  `mulmoterminal room list | read | post` CLI that talks to a running server over loopback.
  Everything after `--` is message text, so a post can carry flags. `--from` is a display label and
  nothing authenticates it.
- **Rooms in the browser: see them, enter one, choose another** (#1456, #1483): **Rooms** in the
  toolbar (the forum icon, beside Pull requests) lists every conversation with its messages and a box
  to post into yourself — the same door a shell uses, since the agents are typed into by the runner
  and can call nothing. A cell's forum menu reaches the running table's room with **read the
  conversation**. The picker's **room** box does naming and reuse together: empty mints
  `table-2026-08-06-…`, a name that already exists **continues** that conversation, and the seats read
  the earlier turns back before they speak. Names are lowercase letters, digits and `-`, up to 64
  characters, refused rather than silently replaced. Two round-table behaviours change with it: a
  speaker is handed **the whole conversation so far** instead of only the previous reply, and a seat
  that uses tools before answering contributes its real answer.
- **Sessions that survived a restart are listed where they can be stopped** (#1478, #1479): a new
  Settings section shows every terminal still running from an earlier server, **across all
  directories** — where it runs, what it is, how long it has been idle, and whether ending it loses
  anything. **Stop** ends that one session; a conversation with a transcript resumes afterwards.
  Before this the process was still running and no screen admitted it.
- **Unused sessions are ended at the next start** (#1467, #1486): `sessionIdleReapDays` (default 7,
  `0` disables, 0–365) bounds how long a terminal may sit with nobody attached and no output. Rows the
  sweep will take are marked **ends at next start**, so it is visible in the list it acts on. The
  change is also a decomposition: one predicate had been answering three different questions —
  "may this be reaped", "is this resumable", "should this be listed" — and separating them is what
  made the sweep safe to add.
- **A busy cell no longer starves the pty it is reading** (#1506, #1508): `growOutputTail` appends by
  concatenation (which V8 keeps as a rope, so O(chunk)) and pays for the exact bound only once per
  `TAIL_SLACK`-worth of output; the two readers — the reattach replay and the phone's headless screen
  fallback — cut it back themselves. `TAIL_SLACK` is 1.25 rather than 2 because an unflattened rope
  costs several times its character count, measured per session at 1.00 MB before, 2.54 MB at 1.25 and
  6.45 MB at 2. Draining the pty at full speed multiplies the reads it produces, so output is also
  batched into frames (8 ms, sent at once when idle so a keystroke echo never waits, capped at
  256 KiB, and not queued at all while no browser is attached): about 8000 frames became about 35 for
  the same bytes, with the same content in the same order and an identical replay on reattach.
- **A killed tmux client no longer takes its session with it** (#1496, #1504): losing the client and
  the program finishing are two different events, and only one of them means the session is over.
  Under tmux the pty this app holds is a *client*, so a client killed from outside used to be read as
  an exit and tore down a session that was still working.
- **Claude's turn boundary is read from `stop_reason`, not inferred** (#1487, #1494): whether a turn
  has ended now comes from what Claude reports, so a cell's working state agrees with the agent
  instead of with a guess over its output.
- **A model id may carry Claude Code's `[1m]` extended-context suffix** (#1503, #1505):
  `claude-opus-4-5[1m]` in a provider config is accepted instead of rejected as malformed. The
  provider-id and model-id rules are deliberately asymmetric — only the model id takes the suffix —
  and a spec pins that asymmetry.
- **Tool-call history costs less to keep** (#1507, #1509): the per-session history was re-serialised
  in full and written to disk on **every** tool call, twice (PreToolUse and PostToolUse) — 3.8 ms of
  blocked event loop for a 3.4 MB list, plus those megabytes on their way to disk. Saves landing in
  one 50 ms window now share a write: for 100 tool calls (200 saves) that is 3 writes when tools
  return instantly, 12 at 5 ms, and still only 101 at 200 ms. One session's writes are also
  serialised, closing a pre-existing hole where two `writeFile` calls truncating the same path
  concurrently could leave a file that was neither version, and at most one write ever waits behind
  the running one — chaining per save would have queued writes that all put the same bytes on disk.
- **A record with a pending completion bell is now visible in the board** (#1491): the collection
  view's Kanban cards accent (red for urgent, amber for a nudge) when a completion watcher has an
  open bell for that record. The publishing half already ran — `collectionWatchers` writes into the
  shared notifier file, and MulmoTerminal's bell has shown those entries for some time — but the
  binding the plugin asks for the per-record severities returned an empty map, so nothing in the
  board reflected it. It now reads the live bell, which means a bell **MulmoClaude** published
  accents the same card here. Read-only: the one-bell-per-record rule stays where it was enforced,
  on the shared `legacyId` server-side.
- **Custom views catch up to MulmoClaude's host surface** (#1490): a collection's custom view can
  now read its translations, resolve a stored image, and press a declared mutate action — the three
  things core's own authoring docs (which MulmoTerminal serves to the agent through
  `manageCollection`'s `schemaDocs`) already told view authors it could.
  `GET …/view-i18n` returns the active locale's dict, and the iframe bootstrap gained the
  `__MC_VIEW.dict` / `__MC_VIEW.t(key, named)` half of the bridge it had been missing entirely — an
  i18n-declaring view used to render raw keys, with nothing reporting a problem. `GET
  …/view-data/image` turns an image field's stored path into a downscaled `data:` thumbnail, which
  is how a desktop view shows a picture at all (the sandboxed iframe cannot put its token on an
  `<img>`); the authorization rule is the record scan itself, so only a **current** value of an
  image field resolves and never an arbitrary workspace file. `POST
  …/view-data/actions/:actionId` lets a write-capable view press a declared **mutate** action
  instead of hand-rolling the same transition as a raw write — mutate only, so a view token still
  cannot start LLM work. All three run the shared `@mulmoclaude/core` engines, and the two scoped
  ones sit behind per-minute budgets with images in a roomier bucket than actions.
- **Remote-host collection and feed records go through the store seam** (#1488, #1495): the phone's
  path read them directly, so the two hosts could disagree about the same record.
- **REST item writes are checked against the schema before anything is written** (#1489, #1497):
  create and update are gated rather than validated after the fact.
- **Windows CI** (#1481, #1482, #1484, #1485): `worktree-pr.spec` no longer spawns the real `gh` and
  time out, and two rooms tests that depended on POSIX permission semantics are skipped there. Both
  were about the tests, not the app.

## mulmoterminal@4.6.0 — 2026-08-06

> **Setup guide:** [Cells that talk to each other, and a history that knows whose it is](https://receptron.github.io/mulmoterminal/guide/en/v4.6.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.6.0.html))

Two cells can now hold a conversation **without you pressing anything between the turns**. Round
table generalises Cross-terminal talk — one human-pressed round trip since #550 — into a ring of up
to five seats running for a set number of turns, and it does so without giving the agents a single
new capability: no MCP tool, no room, no way for an agent to start a conversation or to discover
that another cell exists. A human picks the seats; the browser's runner reads one cell's answer and
types it into the next.

The rest of the release is about **the other three agents catching up with Claude**. The launcher's
resume list was Claude's transcript directory whatever the Agent Picker said, so a Codex, Grok or
Antigravity conversation started outside a grid cell was unreachable from any screen. And the two
header badges — the model with its context percentage, and what the conversation has spent — only
ever appeared on a Claude cell. Both now answer for the agent you actually picked.

### Added

- **Round table — the cells talk to each other, for a set number of turns** ([#1458](https://github.com/receptron/mulmoterminal/pull/1458), refs [#1456](https://github.com/receptron/mulmoterminal/issues/1456) and [#1454](https://github.com/receptron/mulmoterminal/issues/1454)).
  Open a cell's handoff menu, tick the cells that should take a seat, choose a turn budget, press
  start. From then on each agent's answer is carried to the next seat as the next prompt, around the
  ring, until something stops it.

  **No new agent capability, and zero MCP tools.** The runner already does both of the things it
  would otherwise have handed the agents — it *reads* another cell's last turn (`fetchLastTurn`) and
  it *types into* a cell and submits (`pasteAndSubmit`) — so the runner does it on their behalf and
  each agent just talks in its own terminal as always. Two of the three worries raised on #1456
  therefore disappear rather than being mitigated: an agent cannot start a conversation because it
  has no tool for it, and cannot find a partner because it cannot see other cells at all.

  The seat picker is **the only admission control**: at most five seats, and a turn budget of 4, 6,
  10 or 20 (default 6). One turn is one real agent turn, so that number is a runaway guard and a
  wallet setting at the same time. The ring stops on **agreement** (a reply containing the line
  `ROUND-TABLE-DONE`, matched whole-line so that *discussing* the marker does not end the
  conversation), on the budget, on a seat not answering in time, on you pressing stop, on the cell's
  session being swapped, and on a failed send. Closing the cell stops it too.

  One trap is worth recording, because getting it backwards silently corrupts the ring: the framing
  text ("your turn", "write the marker if you agree") is always a **prefix**. Replies are correlated
  to sends by the *last* 160 characters of what was sent — the opening is identical every round — so
  appending the framing would make every round's tail identical, match the *previous* round's
  prompt, and read a reply that has not arrived yet as the answer. A spec pins the failure.

  This is v1, and the runner lives in the browser: closing the tab ends the ring. No room store, no
  HTTP API, no MCP tools, no human or shell seats, no persisted minutes — [#1456](https://github.com/receptron/mulmoterminal/issues/1456) stays open for those.

- **The launcher's resume list is the picked agent's own history** ([#1449](https://github.com/receptron/mulmoterminal/pull/1449), closes [#1417](https://github.com/receptron/mulmoterminal/issues/1417)).
  "OR RESUME HERE" read `~/.claude/projects` whatever the Agent Picker said, so choosing Codex,
  Antigravity or Grok still offered *Claude's* conversations — and clicking one connected that
  agent's endpoint to a key that only ever named a Claude transcript. Meanwhile every real codex /
  agy / grok conversation started outside a grid cell was unreachable from the UI.

  The list is now a function of the agent: one route per agent (`/api/sessions`,
  `/api/codex/sessions`, `/api/antigravity/sessions`, and the new `/api/grok/sessions`), chosen from
  a `Record<TerminalAgent, …>` so a fifth agent is a type error rather than a picker option that
  silently lists Claude's history. Switching the picker replaces the list, the heading names the
  agent when it is not Claude, the resume carries the agent so the cell connects the endpoint that
  wrote the conversation, and Shell shows no list at all. A custom agent runs Claude Code, so it
  gets Claude's.

  The `/api/codex/sessions` and `/api/antigravity/sessions` routes existed since #1096 / #1218 with
  **no caller** — they were built for the single view's sidebar, which #1201 / #1202 removed. This
  is the call site they were kept for. `/api/grok/sessions` is new and is the cheapest of the four:
  `~/.grok/sessions` is partitioned by working directory, so a per-project listing is one directory
  read, with `summary.json` supplying the title and the last-*active* time (not `updated_at`, which
  grok bumps hours later when it generates a title, and which would sort a dead conversation above a
  live one).

  All three foreign lists now also carry `attached`, the field that stops a row being opened twice.
  For codex and antigravity it takes the conversation log read backwards: a conversation started
  from a grid cell is held under a session key MulmoTerminal minted, so asking about the
  conversation id alone would report it free while it is live in another cell — and resuming it
  would start a second agent process on it. grok needs no log for this, because MulmoTerminal mints
  its session id: the key and the conversation id are the same string, so the row's own id answers
  the question.

- **Every agent's cell says which model it is running and how full its context is** ([#1466](https://github.com/receptron/mulmoterminal/pull/1466), closes [#1465](https://github.com/receptron/mulmoterminal/issues/1465)).
  The two badges on the first line of a cell header — `Opus · ctx 35%` and `⇡427k ⇣1.8k` — appeared
  on Claude cells alone. This was never a UI decision: `modelBadge.ts` has always been
  agent-agnostic, and the badges hide themselves when there is nothing to show. The cause was that
  `readSessionSummary`, behind `GET /api/session/:id`, read only Claude Code's transcript format, so
  the other three agents got `{ model: null }` and zeroes.

  The route now picks a reader from `?agent=`. **Claude's path is untouched** — no parameter means
  claude, and those two fields still come out of the summary fold the route already ran. Each agent
  answers only from what its own log actually records: Codex reports `gpt-5.5 · ctx 33%` from
  `token_count` events, with the window taken from codex's own `model_context_window` rather than
  the client's per-model table, which has been wrong (#985). When no tokens have been counted at
  all, the model name is shown without `ctx 0%` — the absence of a reading is not a measurement of
  an empty context.

- **An Antigravity cell reads its real model, context and token usage** ([#1469](https://github.com/receptron/mulmoterminal/pull/1469)).
  #1466 gave agy the fixed label `antigravity`, on the reading that its logs record neither a model
  id nor tokens. Measured against the data, that was wrong on all three counts. agy writes the model
  it is on at the start of **every** conversation (50 of 50 transcripts, always at step 0), which
  makes it a fact about *that conversation* — unlike `settings.json`, which is global and current.
  So the badge reads `Gemini 3.6 Flash` from the transcript's head, `ctx 78%` against agy's measured
  256,000-token window, and `⇡ ⇣` beside it.

  There is no schema for any of it, so every layer is built to show **nothing rather than something
  wrong**: the parser walks only the requested path and stops without resynchronising at bytes it
  does not understand, and the accounting layer discards the *whole* answer when a window is outside
  1 KB–100 M, when `used` exceeds the window, when a count passes a billion, or when a leaf is
  missing — a partial sum is not a small number, it is a wrong one. The two badges are independent,
  so an unreadable accounting still leaves the model name. If agy renumbers its fields, the cell
  falls back to the model name alone; it will not print a wrong percentage.

- **A Grok cell shows how full its context is, and what it has spent** ([#1471](https://github.com/receptron/mulmoterminal/pull/1471), closes [#1470](https://github.com/receptron/mulmoterminal/issues/1470)).
  #1466 left grok with the model alone, on the finding that its conversation directory holds no
  token accounting. That was true of the two files it read (`summary.json`, `events.jsonl`) and
  false of the directory. grok writes `signals.json` — rewritten whole each turn, carrying the
  current context, the model's real window (500,000 for grok-4.5) and the model — plus one
  `turn_completed` record per turn in `updates.jsonl` with that turn's tokens. So a Grok cell now
  reads `Grok · ctx 33%` with the `⇡ ⇣` badge beside it, and like codex it never consults the
  client's window table.

  The per-turn usage is summed rather than tailed — it rises and falls per turn, so only the whole
  file answers — which stays affordable because the fold from #1377 charges a later poll only for
  the bytes the last turn appended. Neither grok nor antigravity drives activity flags, so their
  badges refresh on the once-a-minute timer instead of at turn end; without it, the first reading a
  cell took would be the only one it ever showed.

- **A conversation left running with nobody attached says so, and can be stopped from the launcher** ([#1474](https://github.com/receptron/mulmoterminal/pull/1474), part of [#1467](https://github.com/receptron/mulmoterminal/issues/1467)).
  The `or resume here` rows already answered "is anyone holding this" via `tmux list-clients` —
  which reports **only** sessions that have a client, so the sessions that actually accumulate,
  running with nobody attached after a server restart, were structurally invisible to it. One
  `tmux list-sessions` per list was what was missing. Such rows are now marked, and only they get a
  **stop** button: a row marked `● open` belongs to the terminal holding it, and ending it from
  another cell's launch form would pull a session out from under a tab you cannot see from here.

  It asks before stopping, because the in-flight turn is lost. The conversation is not — the
  transcript stays and the row can be resumed afterwards. What is stopped is the *session key*
  MulmoTerminal minted, not the row's conversation id; for codex and agy those differ, and killing
  the wrong one would report success having killed nothing.

  **[#1467](https://github.com/receptron/mulmoterminal/issues/1467) stays open.** It asks for
  automatic cleanup, and this is the manual half. The list is per directory and per agent, so it
  does not reach a project you no longer open — which is where the reporter's sessions are. Measured
  on one machine with 21 surviving sessions: 12 attached, **5 unattached with claude still running**
  and idle 10–11 hours, 4 unattached with no transcript, and 0 where claude had exited. So what
  accumulates is live agent processes nobody is attached to, and the issue's own proposal
  (`cleanup-orphans` at boot) would reap 4 of those 21 — none of them the 5.

### Changed

- **Four `jscpd/duplicate-code` alerts closed by extracting shared helpers** ([#1473](https://github.com/receptron/mulmoterminal/pull/1473), refs [#1472](https://github.com/receptron/mulmoterminal/issues/1472); follow-up comment in [#1475](https://github.com/receptron/mulmoterminal/pull/1475)).
  Behaviour is unchanged. All four alerts had the same cause — something added later copied the
  same-shaped code next to it, `icon` from `sound` and grok from antigravity — and the real bug is
  the drift where only the copy gets fixed, which is exactly how #1441 happened. So the copies were
  merged into shared helpers (`resolveFileWithinDir`, `liveSessionFacts` / `resolveResumableSession`,
  `handleDirectoryMcpAgentConnection`, `startDirectoryMcpPty`) rather than deleted, making it
  impossible to fix one side alone.

- **`@mulmoclaude/core` 2.1.0 and `@mulmoclaude/markdown-plugin` 2.3.0** ([#1477](https://github.com/receptron/mulmoterminal/pull/1477)).
  Dependency bump only, no source changes. It also removed a second copy of `core`: the other
  plugins declare `^2.0.0` / `^2.0.1` and yarn 1 does not dedupe those onto a newer resolution, so
  2.0.1 was being installed beside 2.1.0.

## mulmoterminal@4.5.1 — 2026-08-05

> **Setup guide:** [A backend with no models says so](https://receptron.github.io/mulmoterminal/guide/en/v4.5.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.5.1.html))

A fix release for two things that looked, from the outside, like the app simply not responding: a
backend you could see but not select, and a button that did nothing at all.

### Fixed

- **A provider with no models is explained rather than drawn as a row you cannot click** ([#1461](https://github.com/receptron/mulmoterminal/pull/1461), closes [#1432](https://github.com/receptron/mulmoterminal/issues/1432)).
  A custom backend appeared in the launch form's MODEL dropdown and could not be selected by a click
  or with the arrow keys. It was never an option: a provider whose `models` is empty rendered as
  `<optgroup label="DeepSeek"></optgroup>` — a group header with nothing under it, which a browser
  draws as a shaded row that the mouse and the keyboard both skip.

  Two silent paths lead there, and the report hit at least one. The measured presets are
  **OpenRouter's alone** — they are matched by the provider's `id`, so a backend registered as
  `deepseek`, `moonshot` or a company gateway starts with no models and must list its own. And a
  malformed `models` entry (`[{"id": "…"}]`, a value with a space, a `models` that is not an array)
  was dropped by the config schema **without a word**, so the file listed models while the UI had
  none.

  The picker now offers only backends that are reachable **and** have a model to pick; the rest are
  named. The link beside the MODEL label reads **Needs attention**, and the panel behind it carries
  the sentence — `provider 'deepseek' has no models to pick — list its model ids under "models" in
  ~/.mulmoterminal/config.json (only 'openrouter' has built-in presets)`. Settings' **Models and
  backends** marks such a backend **not in the picker** instead of `ready`, and the server names
  every model id it dropped, on the terminal it was started from.

  The `mulmoterminal-model` skill and both providers guides said the opposite — *"do not write a
  `models` array, registering the provider is enough"* — which is true only under the id
  `openrouter`, and is what produced the broken entry. Corrected in all three.

- **`Choose a folder…` works on Linux and WSL2 without zenity** ([#1463](https://github.com/receptron/mulmoterminal/pull/1463), closes [#1447](https://github.com/receptron/mulmoterminal/issues/1447)).
  Without `zenity` installed the button did nothing at all — no dialog, no message. Two faults, both
  fixed: the server spawned `zenity` unconditionally on anything that was not macOS or Windows, and
  all three call sites in the UI discarded the resulting 500.

  The picker now tries what the host actually has: macOS `osascript`, Windows PowerShell, **WSL2 the
  Windows dialog over interop** (`powershell.exe`, with the returned path converted by `wslpath` —
  nothing to install), and a Linux desktop `zenity` → `kdialog` → `qarma` → `yad`. When none exists
  the UI **says so** rather than appearing broken, and `init` reports on Linux which dialog this host
  has. `POST /api/open-dir` carried the same swallowed-failure bug and was fixed with it.

- **The launch form's controls have a width again** ([#1460](https://github.com/receptron/mulmoterminal/pull/1460), after [#1455](https://github.com/receptron/mulmoterminal/pull/1455)).
  Every row of the form was capped at 360px, so a wide cell drew a narrow centred column — 25
  directory chips wrapped into 20 rows inside 360px while the cell was 1535px wide. #1455 removed the
  cap, which fixed the chips and stretched everything else: at a 1535px cell a checkbox sat most of a
  screen from its label. The two are now separate — **chips take the whole cell** (they tile, so
  width buys rows back), **every other control shares one 560px cap**, and the agent picker keeps its
  own content width.

- **Four path-dependent tests that failed only on Windows** ([#1462](https://github.com/receptron/mulmoterminal/pull/1462)).
  `Windows (daily)` had been red on main across both Node 22.x and 24.x while lint, typecheck and
  build were green. All four expected path shapes Windows does not produce — a `path.join`ed
  candidate that is a `/`-separated constant, a drive-less absolute path that `path.resolve` completes
  with the current drive, and a temp dir resolved by the JS `realpathSync` where production uses
  `.native` (which is what expands an 8.3 short name). Windows does not run on `pull_request`, which
  is how they reached main green on macOS.

### Documentation

- **The 4.5.0 setup guide covers the whole release** ([#1451](https://github.com/receptron/mulmoterminal/pull/1451)).
  It had shipped covering `repo.json` only; it now documents `worktreeEnv`, Grok and `customAgents`,
  and the twelve settings that gained controls — each with a screenshot taken against a running
  server.
- **Release pages have their own `nav_order` range** ([#1452](https://github.com/receptron/mulmoterminal/pull/1452), [#1453](https://github.com/receptron/mulmoterminal/pull/1453)).
  The sidebar read *4.5.0 → glossary → 4.4.0*: the version pages had grown into the numbers the
  reference pages occupy, and just-the-docs breaks a tie by title. The reference guide now keeps
  **1–999** and release pages start at **1001**, newest first, so the two ranges cannot meet again.

## mulmoterminal@4.5.0 — 2026-08-05

> **Setup guide:** [repo.json, a port per worktree, Grok, and settings you can reach](https://receptron.github.io/mulmoterminal/guide/en/v4.5.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.5.0.html))

A repository can now **say what it is**, and MulmoTerminal listens. `repo.json` is a small open
metadata file at a repository's root — name, description, icon, colour — that any tool displaying
repositories can read, not a file this app invented for itself. A project ships one and its cell
carries its own mark and palette everywhere it appears.

The gap it fills is measurable. Across 157 git repositories on one machine, **5 had a web app
manifest and 26 had any icon at all** — every one of them a web project. The other 131, the ML
repos and CLI tools and libraries you actually open in a terminal, had nowhere to put this.
Those 131 are what the format is for.

Also in this release: each git worktree can be handed **its own dev-server port and database name**,
**Grok** joins the Agent Picker as a first-class agent, and the settings that could only be reached
by hand-editing JSON now have controls.

### Added

- **`repo.json` — an open repository metadata file** ([#1440](https://github.com/receptron/mulmoterminal/pull/1440) spec, [#1445](https://github.com/receptron/mulmoterminal/pull/1445) implementation, closes [#1438](https://github.com/receptron/mulmoterminal/issues/1438) and [#1442](https://github.com/receptron/mulmoterminal/issues/1442)).
  Four lines give a project a named, coloured, icon-bearing cell:

  ```json
  { "name": "diffusion-lab", "icon": "docs/logo.png", "color": "#7c3aed" }
  ```

  **One colour becomes seven.** The header takes it exactly; the badge, border, status dot, buttons
  and cell body are derived from its hue; the header text is derived for contrast and is never
  declared, so it stays readable whatever colour a project picks. The derivation is measured, not
  invented — against eleven hand-tuned palettes it lands at a **median ΔE76 of 1.9, worst case 2.5**,
  and one derived value came out byte-identical to the hand-picked one. The measurement's finding
  was that no single rule fits every role: the badge sits *relative* to the brand colour while the
  surfaces sit at *absolute* lightness, and using either rule alone drifts by ΔE 15–20 at one end of
  the hue wheel.

  Three layers, general to specific — `repo.json` → `.mulmoterminal.json` →
  `.mulmoterminal.local.json` — each replacing whatever keys the one below it set. Anything this app
  understands that the open format doesn't goes under `extensions.mulmoterminal`.

  The [specification](https://receptron.github.io/mulmoterminal/repo-json.html) is written to be
  implemented by anyone. Its rules are the interesting part: paths resolve against the repository
  (not a web root, which is what makes every other format web-only), a consumer keeps looking until
  an icon *resolves* rather than stopping at the first that exists, and text colour is derived
  rather than declared so two conforming tools reach the same answer.

- **A project's own favicon is picked up with no configuration** ([#1429](https://github.com/receptron/mulmoterminal/pull/1429), closes [#1428](https://github.com/receptron/mulmoterminal/issues/1428)).
  A directory that names no icon shows the one its repository already ships: `public/favicon.svg`,
  `apple-touch-icon.png`, `favicon.png`, `favicon.ico`, then a web manifest's largest non-maskable
  icon. Ordered by how the image survives being drawn at 14px rather than by how common it is, and
  `docs/logo.png` is deliberately *not* searched — a "logo" is as often a wide README banner as an
  icon. On by default; Settings → **Directory appearance** turns it off, or `"icon": false` does for
  one project.

- **An image icon on every cell** ([#1427](https://github.com/receptron/mulmoterminal/pull/1427), closes [#1421](https://github.com/receptron/mulmoterminal/issues/1421)).
  The mark appears at the **left edge** of the cell header — the browser-tab position — and on the
  cockpit roster, the filmstrip thumbnails and the launcher's directory chips. PNG, JPEG, **animated
  GIF** (it plays), WebP, AVIF, SVG, ICO and BMP; a path inside the directory, an `http(s)` URL or a
  `data:` image. A file is served through a route that types the response from our own extension map
  and sets `nosniff` + `Content-Security-Policy: sandbox`, so allowing SVG costs nothing.

- **`.mulmoterminal.local.json` — per-checkout overrides** ([#1431](https://github.com/receptron/mulmoterminal/pull/1431), closes [#1430](https://github.com/receptron/mulmoterminal/issues/1430)).
  Several clones of one repository share a project config and differ only in the colour that tells
  them apart in the grid. The local file replaces whatever top-level keys it names; the shared file
  keeps everything else. Both trigger the live reload, and Settings names both files and lists which
  keys the local one took over — because with more than one file, "which won" is the question.

- **A dev-server port and database name per worktree** ([#1435](https://github.com/receptron/mulmoterminal/pull/1435), closes [#1367](https://github.com/receptron/mulmoterminal/issues/1367)).
  Declare a variable once and each worktree gets its own value, so two `yarn dev` stop fighting over
  port 3000.

- **Grok as a fourth first-class agent** ([#1441](https://github.com/receptron/mulmoterminal/pull/1441)), beside Claude, Codex and Antigravity in the Agent Picker.

- **The Agent Picker holds agents you configure** ([#1411](https://github.com/receptron/mulmoterminal/pull/1411)).
  A `customAgents` entry is your own command line for starting Claude Code — a wrapper, a pinned
  binary, `ollama launch claude --model … --` — and Claude Code's own arguments are appended to it,
  so the session still resumes and still reports cost.

- **Settings reaches the keys that needed hand-edited JSON** ([#1412](https://github.com/receptron/mulmoterminal/pull/1412), [#1416](https://github.com/receptron/mulmoterminal/pull/1416), closes [#1401](https://github.com/receptron/mulmoterminal/issues/1401)).
  An inventory found nine keys no skill documented and twelve with no control anywhere. A test now
  fails when a new global setting is added without saying where a user can set it.

### Changed

- **This repository ships its own `repo.json` and `favicon.svg`** ([#1448](https://github.com/receptron/mulmoterminal/pull/1448)). The favicon existed only as an inline `data:` SVG in `index.html`; it is now a file the metadata can point at.
- **`.mulmoterminal.json` is committed rather than gitignored, and worktree inheritance writes `.mulmoterminal.local.json`** ([#1437](https://github.com/receptron/mulmoterminal/pull/1437), closes [#1436](https://github.com/receptron/mulmoterminal/issues/1436)). Committing the shared file used to switch worktree tinting off silently, because the check asked about the file it was *not* writing. A repository set up the old way still works — the shared file remains a fallback.
- **A launcher chip runs its command line verbatim** ([#1409](https://github.com/receptron/mulmoterminal/pull/1409)). The parser that recognised `claude` or `codex` in a chip's command and rewrote it is gone. A chip that silently ran something other than what it said is what made chips and the Agent Picker impossible to tell apart.
- **`useSessions` lost the last of the sidebar** ([#1420](https://github.com/receptron/mulmoterminal/pull/1420)) — 231 lines to 70.
- **Plugin bumps**: `@mulmoclaude/markdown-plugin` 2.1.0 then 2.2.0, `html-plugin` 2.1.0 ([#1434](https://github.com/receptron/mulmoterminal/pull/1434), [#1444](https://github.com/receptron/mulmoterminal/pull/1444)); Antigravity agent updates ([#1446](https://github.com/receptron/mulmoterminal/pull/1446)).

### Fixed

- **A gentle trackpad scroll moved nothing** ([#1414](https://github.com/receptron/mulmoterminal/pull/1414), closes [#1200](https://github.com/receptron/mulmoterminal/issues/1200)). Sub-line deltas were dropped instead of accumulated.
- **Codex conversations survive a restart** ([#1424](https://github.com/receptron/mulmoterminal/pull/1424), closes [#1418](https://github.com/receptron/mulmoterminal/issues/1418)). The rollout id lived in memory only, so a server restart plus a lost tmux session meant the conversation could not be resumed.
- **The workspace's "all tools" check counts the agent** ([#1425](https://github.com/receptron/mulmoterminal/pull/1425), closes [#1423](https://github.com/receptron/mulmoterminal/issues/1423)).
- **Antigravity's shared MCP config is not rewritten on a tmux reattach** ([#1446](https://github.com/receptron/mulmoterminal/pull/1446)).

### Docs

- **The `repo.json` specification** ([#1440](https://github.com/receptron/mulmoterminal/pull/1440)) — published at [receptron.github.io/mulmoterminal/repo-json.html](https://receptron.github.io/mulmoterminal/repo-json.html).
- **Worktrees and header customization became their own pages** ([#1433](https://github.com/receptron/mulmoterminal/pull/1433)), the latter a screenshot-led beginner's guide.
- **Antigravity needs Canvas registration in the workspace too** ([#1439](https://github.com/receptron/mulmoterminal/pull/1439)) — plus three places that said the opposite.
- **The workspace rules brought in line with 4.3.0 and 4.4.0** ([#1408](https://github.com/receptron/mulmoterminal/pull/1408)); the path menu screenshotted ([#1413](https://github.com/receptron/mulmoterminal/pull/1413), [#1415](https://github.com/receptron/mulmoterminal/pull/1415)); `facts.json`'s `$schema` made to resolve ([#1407](https://github.com/receptron/mulmoterminal/pull/1407)).

## mulmoterminal@4.4.0 — 2026-08-04

> **Setup guide:** [Every cell keeps its own pane, and the Canvas opens a file on its own](https://receptron.github.io/mulmoterminal/guide/en/v4.4.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.4.0.html))

The largest release since 4.0.0, and it pulls in two directions at once. The **right pane became
per-cell** — walking the zoom now shows what *that* terminal had open — and the **Canvas learned to
open a file on its own**, so reading a document no longer means asking an agent to show it to you.
Underneath, the five places that re-read an entire transcript on every request now **resume a fold
instead**: a 2.1 GB project's session list went from 8.7 s to 1 ms, and the numbers below are all
measured against real transcripts on this machine, not estimated.

It also restores something that had been quietly missing the whole time: **your claude.ai connectors
and your own MCP servers work in the workspace cell and the single view**, which is where they were
most expected and least available.

### Added

- **Every cell keeps its own right pane** ([#1397](https://github.com/receptron/mulmoterminal/pull/1397), closes [#1378](https://github.com/receptron/mulmoterminal/issues/1378)).
  The pane already knew everything about a cell except whether to be there. *Which* file the tree had
  open and which directories were expanded were per-cell; the canvas is read per session; but "is a
  pane open, and which one" was **one value for the whole grid**. Opening the canvas on one terminal
  opened it on the next, and closing it there closed it on the first.

  Each cell now answers for itself. Walking the zoom shows that cell's pane — files, canvas, tools or
  nothing. A cell that never asked for one arrives with none, and closing is an answer too, so it
  stays closed. A pane can be asked for on a **tiled** cell, which is where the issue starts: the
  canvas cannot open with nothing enlarged, so the press records what that terminal should have and
  enlarging it opens it. A reload restores by **session** rather than by cell id — a uid is a
  different number next time — capped at 40, LRU. Width and the full-width takeover stay shared.

- **Open a document, an HTML page or a MulmoScript in the Canvas without an agent** ([#1380](https://github.com/receptron/mulmoterminal/pull/1380), [#1388](https://github.com/receptron/mulmoterminal/pull/1388), refs [#1374](https://github.com/receptron/mulmoterminal/issues/1374)).
  The Canvas draws a session's **tool results**, so looking at a file already sitting on disk meant
  asking an agent to present it. The Files pane's toolbar now has a Canvas button: press it and a
  synthetic card is written through **the same route the agent's own tool posts to**. The card is
  therefore stored, survives a reload, and folds together with the agent's card for the same file —
  no reconciliation code and no new server route.

  Markdown and HTML shipped first; MulmoScript stories followed, and they broke both assumptions the
  first two were built on. The other tools take an absolute path and the View self-fetches; the story
  tool **refuses** an absolute path and the card carries the **parsed script**. So its gate asks a
  different question — *is this file in the workspace's story directory?* — rather than *can you
  render this file?* The eligibility check is delegated to the plugins' own gates rather than a
  home-grown extension test, which is what rejects `artifacts/documents/../../secrets.md`.

  Two bugs here were caught only by opening a real browser, having passed lint, typecheck and 7,822
  tests: the Files pane's rows are **cell-cwd relative** while the plugin's file layer is rooted at
  the **workspace**, so a card was written, the pane opened, nothing rendered and nothing failed; and
  the enable/disable gate existed in two places, so fixing the button left the panel still saying
  "Canvas is not enabled for this session" on top of a perfectly good card.

- **A drawing on the tiled grid reveals itself, and a single terminal can enlarge** ([#1371](https://github.com/receptron/mulmoterminal/pull/1371)).
  An agent calling `presentDocument` / `presentChart` **is** its answer to what was asked. On the
  tiled grid that answer left no trace but a count on a chip, because the Canvas pane exists only
  beside an enlarged cell. Now the drawing cell enlarges itself and the Canvas opens beside it,
  through the same `openCanvasFor` the unread-canvas chip uses. Nothing happens while a full-screen
  overlay is up: the user is reading something else, and rearranging the grid behind them would greet
  them with a zoom they never asked for.

  Building it surfaced that [#374](https://github.com/receptron/mulmoterminal/issues/374)'s rule —
  refuse to zoom with fewer than two running cells — had to go, and it is worth saying why, because
  the rule still reads as sound. Zooming is "one big, the rest as a filmstrip", so with nothing to
  switch to it trades a working layout for an empty one. What it missed is that the zoomed row is
  **also the only place the Canvas / Tools / Files panes exist**. On a one-terminal grid it did not
  merely decline a layout; it locked those panes away, so the chip did nothing when clicked and a
  drawing had nowhere to go — with no error on either side. The reasoning is written down in three
  places rather than left to be re-derived.

- **One work comment per issue, edited as the work moves** ([#1376](https://github.com/receptron/mulmoterminal/pull/1376), refs [#1369](https://github.com/receptron/mulmoterminal/issues/1369)).
  `issueWorkComments` (still **off by default**, still global) said two things and then went quiet —
  *work started*, and *it merged* — each as a new comment, with silence in between. A clone now keeps
  **one** comment per issue and edits it as the work moves through three milestones: started, PR
  opened, merged.

  **CI is deliberately absent**: it is on the PR already, and it flaps, and an issue reporting every
  turn stops being readable. Times are **UTC** and they are the point — a claim posted three weeks
  ago and never updated reads differently from one that moved this morning. The comment says it came
  from MulmoTerminal, because these land on issues other people filed. Editing sends **no
  notification**, on purpose: the first line is news, the rest is status.

- **The work comment now says why it could not be written** ([#1403](https://github.com/receptron/mulmoterminal/pull/1403)).
  It used to fail silently whichever way it failed — a `gh` logged in without write access did
  nothing, forever, indistinguishable from leaving the setting off. Three layers were dropping the
  cause: `ranOk` discarded the CLI's stderr, `ensureWorkComment` collapsed everything into one
  `gh-failed`, and the client's `postWorkComment` swallowed the response in a bare `catch {}`.

  The stderr is now classified into `cli-missing` / `auth` / `permission` / `unknown` — on the **HTTP
  status, not the English**, since the three spellings agree on nothing else — warned once per (repo,
  cause) in the server log, and shown in the cell header as a dismissible `issue not updated — …`
  notice naming the fix. The work itself is unaffected, exactly as before: the comment is skipped and
  the next milestone retries. A 404 is deliberately **not** treated as `permission`, because the
  issue was read successfully moments earlier, so naming the wrong fix seemed worse than naming none.

- **The cell header's path is a dropdown on row 2, and six permanent icons are gone** ([#1382](https://github.com/receptron/mulmoterminal/pull/1382)).
  The two header rows are now organised by **scope** rather than by the "info or action" split they
  claimed: row 1 is what you compare across nine cells at once, row 2 is what you read or do about
  the one in front of you. The comment in `TerminalCell.vue` asserted the old rule; the code broke it
  in both directions.

  The path moved to row 2 and became a menu — reveal in the file manager, browse files in the app,
  new terminal here, then repository / issues / pull requests when a GitHub URL resolves. `reveal`,
  `files`, `terminal` and `gh` left `DEFAULT_BUTTONS`, and the GitHub SVG button left the header:
  each was "do something to this directory", which is what the path itself now expresses — `reveal`
  was byte-for-byte the same action as clicking the path. `pick-file` stays (it types into the
  prompt, it does not go anywhere) and so does `pr` (it hides itself when there is no PR). If you
  configure `buttons` yourself you are unaffected.

  **The GitHub menu did not go away — it moved.** That icon opened a menu of its own with three
  items, and the same three sit below the separator in the path menu, with the same destinations and
  the same `githubUrl` gate: **Repository**, **Issues**, **Pull requests**. Worth stating outright,
  because the first person to go looking for that icon and conclude the feature had been deleted was
  the maintainer. **The path menu itself is fixed** — its contents are not configurable, and nothing
  needs restoring to get those three back. A `gh` button in your own `buttons` list still works
  exactly as before if you want one as a permanent icon; you then have it in both places. The
  [setup guide](https://receptron.github.io/mulmoterminal/guide/en/v4.4.0.html#header-icons) now
  shows the open menu ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.4.0.html#header-icons)).

### Changed

- **A session started in the workspace is badged `WORKSPACE`, not by its folder name** ([#1389](https://github.com/receptron/mulmoterminal/pull/1389)).
  The launcher's chip for that directory says `WORKSPACE`; starting a session from it produced a cell
  badged with the `name` out of that folder's `.mulmoterminal.json` — so one directory wore two names
  across a single click. The badge keeps the directory's **colours** and only the wording is
  role-based, and the configured name moves to the hover tip. It renders even when the directory has
  no `name` at all: the role does not come from the config, so the one cell that most needs
  identifying must not be the one with no badge.

  `defaultCwd` is bound once in `gridCellProps()` rather than threaded per cell type. "Remember to
  pass it" is the design that produced the same omission three times already —
  [#902](https://github.com/receptron/mulmoterminal/pull/902) (theme/font),
  [#914](https://github.com/receptron/mulmoterminal/pull/914) (the name badge) and
  [#1006](https://github.com/receptron/mulmoterminal/pull/1006) (the six chrome colours).

- **A directory's Canvas tool groups stand down for a session that already has every tool.**
  Fallout from the fix above, handled rather than left: with the isolating flag gone, a directory
  that registered per-group MCP URLs could hand a workspace session a second copy of tools it
  already reaches — `mcp__mt__presentChart` and `mcp__mulmoterminal-render__presentChart` for one
  action. The session is now recorded as carrying the full GUI MCP **at spawn**, and the group URLs
  serve it nothing. Deciding it at spawn is what makes it independent of which URL the agent's MCP
  client happens to dial first.

  The obvious alternative — withhold our GUI MCP when the directory registered groups — would have
  re-broken [#1188](https://github.com/receptron/mulmoterminal/pull/1188): the groups do not cover
  the tools that belong to no group, `spawnBackgroundChat` among them.

  The record is also **released** when a session is respawned without the all-tools URL, which the
  log it lives in could not express before — it was append-only on the stated grounds that "nothing
  removes one". That stopped being true the moment a stale yes could stand a cell's groups down with
  nothing to serve them: a session id outlives its process, and one opened in the single view can be
  respawned as a project-directory cell. It now takes the same shape the tool-group log already uses
  for the same reason — an append log with a release marker, replayed in order, and a bare id still
  reads as a claim so existing files keep working.

- **Workspace cells and the single view start slower if you have several MCP servers configured**,
  because they now load them. The same trade MulmoClaude already makes on the same workspace.

### Fixed

- **Your claude.ai connectors, and your own MCP servers, now work in the workspace cell and the single view** ([#1338](https://github.com/receptron/mulmoterminal/issues/1338), [#1385](https://github.com/receptron/mulmoterminal/issues/1385)).
  Gmail, Calendar, Drive, Slack, Notion — anything authorised on your claude.ai account — were
  invisible to exactly the two kinds of session meant to be the most capable, along with
  `~/.claude.json`, your plugin MCP servers and the directory's own `.mcp.json`. A cell in any other
  directory had them all. `claude mcp list` said "Connected" the whole time, because that is the CLI
  running its own health check rather than reporting what a running session can see.

  Two flags were being pushed on one line. `--mcp-config` **adds** our GUI broker; `--strict-mcp-config`
  makes it the **only** source. So "give this session the GUI panel" also meant "cut it off from
  everything you configured" — for the single view since the beginning, and for the workspace cell
  since 4.0.0 gave it the same treatment. The two reports were filed separately, one as a regression
  and one as by-design; they are one line.

  The isolating flag is gone (deleted, not made an option — a one-valued flag is the same weld
  waiting to be re-made). What put it there was a worry that merging config layers would silently
  drop our own broker; measured on CLI 2.1.221, `--mcp-config` alone yields the broker **and** the
  connectors, while adding the strict flag yields the broker alone. MulmoClaude, which drives the
  same workspace, reached that conclusion at CLI 2.1.163 and has run without it since.

  A launcher chip running `claude` drops it on the same commit: parity with the cell beside it was
  why the chip carried the flag, so it is why the chip loses it.

  The rate-limit probe keeps its own `--strict-mcp-config`. That is a hidden session asking one
  question that needs no tools, where isolation buys 8.0 s to first window instead of 9–15 s.

- **A finished background task replaced the cell's task line with the harness's XML** ([#1384](https://github.com/receptron/mulmoterminal/issues/1384)).
  A session running a Monitor or a subagent showed `<task-notification> <task-id>…` on row 1 from the
  moment that task reported, and the AI title was then generated from it. "A harness-injected block
  is not a typed prompt" was already decided — but the commit that decided it touched only the path
  that **reads a transcript**, and the live `UserPromptSubmit` hook, which is what actually writes the
  header, never learned it. `preferredHeaderPrompt` could not save it either: its one guard drops
  short acks like "ok", and a 200-character XML block is the opposite of trivial, so it was taken as
  the session's most meaningful prompt and stayed.

  The judgment is now one exported predicate that both paths call, and the hook refuses an injected
  prompt before it becomes an effect — which covers the header text and the AI title together, and
  through them the session list, the remote host's terminal screen, and the Web Push body. Refusing
  means "change nothing", not "clear it", so the task the user actually typed stays on screen while
  the background task reports.

  `<system-reminder>` joins the list defensively. Across every transcript on the development machine
  — 9,902 files, 26,465 user lines — it has never once led a user line, and running the new predicate
  over all of them refuses exactly the same 4,832 lines as the old one: no real prompt changes hands.
  The anchor is what makes that safe, and it is load-bearing: 591 of those lines *mention*
  `<task-notification` mid-sentence, and matching them would delete the prompt instead of the
  injection.

- **Changing the directory in an empty cell's launcher no longer leaves the previous directory's sessions clickable** ([#1375](https://github.com/receptron/mulmoterminal/pull/1375), [#1372](https://github.com/receptron/mulmoterminal/issues/1372)).
  Resume history, worktree rows and script chips stayed on screen showing the **old** directory's
  entries until a new response arrived, roughly a 300 ms debounce plus a round trip. Those sessions
  are real, so clicking one **opened exactly that session** — one having nothing to do with the
  directory on screen.

  The three lists are now emptied the instant the field changes, in-flight responses are dropped by
  advancing a request token, and one `Loading this directory's sessions, worktrees and scripts…` line
  stands in for all three. One line rather than three skeletons, because a per-section skeleton would
  invent headings for sections this directory may not have — a non-git directory has no worktrees.
  The launch button stays pressable while loading: the "this worktree is in use" warning needs the
  worktree list, but it was previously judging against *another directory's* list, which was worse,
  and the server refuses for real either way.

- **A corrupt sidecar no longer makes a session vanish from the list** ([#1390](https://github.com/receptron/mulmoterminal/pull/1390)).
  The new sidecar's `scannedTo` is untrusted JSON on disk, and it was validated with
  `typeof === "number"` — which accepts negatives and fractions. That value becomes a file offset:
  `createReadStream(file, { start: -1 })` throws `ERR_OUT_OF_RANGE`, the session list catches the
  throw with `.catch(() => null)` and **drops that row**, and because the sidecar keeps being read the
  session stays gone rather than being rebuilt. `size` and `scannedTo` must now be non-negative safe
  integers and `mtimeMs` finite, folded into one named predicate so a reader can see what is being
  rejected.

- **The Windows daily CI is green again** ([#1400](https://github.com/receptron/mulmoterminal/pull/1400)).
  Two separate causes, both of them a **rule copied instead of called**. `os.homedir()` reads
  `USERPROFILE` on Windows, not `HOME`, so specs that redirected `HOME` to a temp directory had the
  implementation writing to **the runner's real home** — and the specs that did not check paths
  therefore *passed* while quietly polluting it, which is the worse half. And three specs built the
  transcript directory name themselves with `CWD.replace(/\//g, "-")`, while `projectSessionsDir`
  resolves the path first and folds every non-alphanumeric character, so `/Users/me/proj` is
  `-Users-me-proj` on macOS and `D--Users-me-proj` on Windows: the specs wrote transcripts where the
  reader never looks and then asserted on the empty result.

  Both now go through one place — `test/support/scratchHome.ts`, which sets both variables and
  **verifies `os.homedir()` actually returns the temp directory**, so a half-applied redirect fails
  on the spot with a reason instead of surfacing later as an empty directory. Verified by dispatching
  the Windows workflow at this branch twice: 10 → 7 failures after cause 1, green on 22.x and 24.x
  after cause 2.

- **Every request in `canvasOpenFile` has a deadline, and the plugin ordering is pinned** ([#1391](https://github.com/receptron/mulmoterminal/pull/1391)).
  Carried forward from a review that finished after its PR had merged. The reopen call blocks the
  Canvas from opening, so a server that never answers left the button pressed and nothing happening —
  which a user cannot tell apart from "this file cannot be shown". Separately, markdown and HTML are
  asked before the story branch in `buildCanvasCard`; if either ever accepted `.json`, **every story
  in the workspace would quietly open as that other thing**, with no error anywhere. That order is
  now pinned against the plugins themselves rather than against a reading of them, since a package
  upgrade is exactly how it would change.

- **The PR number in a work comment's own patterns is bounded** ([#1383](https://github.com/receptron/mulmoterminal/pull/1383)).
  The milestone lines are read back out of a body **anyone on the issue can edit**, and the pattern
  accepted a digit run of any length — `Number("9".repeat(20))` is `1e20`, which the next edit would
  have written back as `- PR #1e+20`. The bound moved into the pattern (ten digits: far more than any
  forge issues, still exact as a `Number`), so an oversized line now fails to match at all and is
  dropped like any other line that is not what render wrote.

### Performance

Five call sites re-read whole transcripts on every request. All five now resume an **incremental
fold** — memory, then a sidecar on disk, then only the bytes that were appended — through one shared
`createTranscriptFold`. Every number below was measured on real transcripts on the development
machine, against copies so the originals were untouched.

- **The session list** ([#1379](https://github.com/receptron/mulmoterminal/pull/1379), [#1377](https://github.com/receptron/mulmoterminal/issues/1377)).
  `/api/sessions` read the 50 most recent transcripts **in full on every request** to extract three
  fields — 4.8 s on a 1.1 GB project, 8.7 s on a 2.1 GB one, to return 17 KB of JSON. The line count
  never changed; the bytes behind the lines did, which is why it got slower the more you used it.
  Unchanged file: **not one byte read**. Grown: only the new part. Shrunk or rewritten at the same
  length: read from the start. The first read does not read everything either — large files are read
  from **both ends** (256 KB head / 512 KB tail), but that window is a fast path and **not** the
  answer: if the three fields are not all found it falls back to the whole file, because "not in the
  window" and "not in the file" are different facts. The window is sized from measurement, not
  instinct — across the 60 transcripts over 5 MB here, the first `user` record sits at most 26.6 KB
  in and `ai-title` / `last-prompt` at most 52.8 KB from EOF; the window is about ten times that.

  | project | 50 most recent | before (every time) | after, first | after, subsequent |
  |---|---:|---:|---:|---:|
  | mulmoterminal4 | 28 MB | 117 ms | 44 ms | **0–1 ms** |
  | mulmoclaude3 | 1,135 MB | 4,670 ms | 492 ms | **1 ms** |
  | mulmoclaude2 | 2,104 MB | 8,700 ms | 2,057 ms | **0–1 ms** |

- **…and it survives a restart, and other processes** ([#1387](https://github.com/receptron/mulmoterminal/pull/1387), [#1386](https://github.com/receptron/mulmoterminal/issues/1386)).
  The fold above lived in **one process's memory**, so two places still paid in full: a restart, and
  every other copy of the app. On this machine eight MulmoTerminals run against the same
  `~/.claude/projects`, each warming the same 500 MB separately. The fold and its offset are now
  persisted to a small JSON beside the transcript. A second process sees 2,112 MB in **23 ms**
  instead of 1,795 ms, and the whole index for two projects is 24 files / 96 KB.

  The **10 MB threshold** comes from the distribution of 9,883 real transcripts / 9.6 GB: the median
  is 93 KB, files over 10 MB are 82 of them but **82% of all bytes**. A sidecar is an invitation for a
  *wrong* answer to survive a restart, so it is distrusted aggressively — version mismatch, file
  shrunk, same size with a moved mtime, offset past EOF, value failing its type guard, malformed JSON:
  each silently rebuilds. It also hashes the **first 256 bytes**, because `(mtime, size)` cannot tell
  "appended to" from "replaced by something longer", and a sidecar may be reading a record written
  days ago. Writes are tmp + rename, since eight processes share the directory.

- **Cost and the timeline overlay** ([#1392](https://github.com/receptron/mulmoterminal/pull/1392)).
  `/api/cost` summed up to 200 transcripts on every open — 2.4 s on a 1.1 GB project — and the
  timeline read a whole transcript for its most recent 300 events, 2.2 s on a 508 MB session. Both
  now resume: 0–1 ms warm, and 3–13 ms for a fresh process reading the sidecar. **The first read is
  deliberately not faster**: unlike a title, a total cannot be answered from part of a file. What
  changed is that "every time" became "once".

- **The session summary, which every grid cell requests at the end of every turn** ([#1395](https://github.com/receptron/mulmoterminal/pull/1395)).
  Its cache was keyed on `(mtime, size)`, which can only skip a file that has **not changed** — so the
  session you are actually working in, the one most likely to be huge, re-read in full **every turn**.
  On a 508 MB transcript that is 2.15 s with the event loop blocked, freezing every terminal in the
  app. After one appended turn: **3 ms**. This fold was the last one that could not share the common
  path, because it accumulated **raw records** — every `user` record (13,664 of them here) to pick the
  most meaningful prompt at the end. The fix was to move the *rule* rather than re-derive its answer:
  "last non-trivial prompt → last prompt → the `last-prompt` record" only ever needs **three strings**,
  so it folds into a `PromptTrail` as records arrive.

- **The decision scan** ([#1404](https://github.com/receptron/mulmoterminal/pull/1404), [#1402](https://github.com/receptron/mulmoterminal/issues/1402)).
  The last one, behind `/api/decisions` (the `mulmoterminal-decisions` skill) and a six-hourly digest
  tick. 484 MB re-read on each: 2.2 s, event loop blocked. After one appended turn, **1.3 ms**; a
  second process resuming from the sidecar, **4.5 ms**. Across a whole 65-transcript / 2.4 GB project,
  a cold-but-indexed process went from 5,547 ms to **66 ms**.

### Internal

- **One bounded fetch for the whole UI** ([#1398](https://github.com/receptron/mulmoterminal/pull/1398), [#1393](https://github.com/receptron/mulmoterminal/issues/1393)).
  `src/` had **80 `fetch` calls and 10 deadlines**, and those 10 were the same
  `AbortController` + `setTimeout` + `clearTimeout` written out in ten different files. A request with
  no deadline does not fail — it does **nothing, forever**, and the screen cannot tell that apart from
  "there was nothing to show". 79 of the 80 now go through one helper, in three tiers: 8 s for
  ordinary `/api` reads and writes, 60 s for anything that shells out (git, `gh`, whisper), 300 s for
  media bytes.

  Reading the server changed the answer twice, and guessing would have got both backwards.
  `/api/pick-file` looks like an ordinary POST but spawns a native dialog and answers when the
  **user** finishes choosing — it is the one route deliberately left unbounded, since any number there
  is a guess at how long a person takes. `/api/transcribe/model/download` looks like the slowest call
  in the app, but it starts the download and returns the status immediately, so it takes the default.

### Docs

- **Who builds this, in the README, the FAQ and `facts.json`** ([#1405](https://github.com/receptron/mulmoterminal/pull/1405)).
  It was not written down correctly anywhere, and `docs/facts.json` — the machine-readable file
  comparison sites and language models read — named the wrong organisation entirely. It is
  **receptron**: Satoshi Nakajima and Isamu Arimoto, who have been shipping open source together
  since 2015. The FAQ gains "Who builds this, and will it still be here next year?", which answers by
  pointing at the MIT licence rather than by promising anything.

- README project-name formatting ([#1406](https://github.com/receptron/mulmoterminal/pull/1406)).

### Chores

- Dependency updates ([#1373](https://github.com/receptron/mulmoterminal/pull/1373)) — plugin
  packages, security tooling, WebSocket support, TypeScript execution and lint utilities.

## mulmoterminal@4.3.1 — 2026-08-04

> **Setup guide:** [The workspace chip says WORKSPACE](https://receptron.github.io/mulmoterminal/guide/en/v4.3.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.3.1.html))

A polish release on the day 4.3.0 shipped: the chip that release added now names its
**role** instead of a folder, and a duplicated poll behind two header chips is one function.

### Changed

- **The workspace chip is labelled `WORKSPACE`** ([#1365](https://github.com/receptron/mulmoterminal/pull/1365)).
  Every other chip is a *place* — the basename of a directory you have launched in. This one is a
  *role*: the base a session works from, the only directory every GUI tool reaches, where the shared
  wiki / collections / accounting live. Calling it `mulmoclaude` said the least interesting true
  thing about it, and made it look like one project among the others. Upper-case because its
  neighbours are lower-case basenames, so it does not read as a directory name either.

  It overrides the "keep the user's label" rule 4.3.0 introduced — for this chip the role is worth
  more than a name someone typed. The real path stays in the hover, where every other chip keeps it.
  The **screen-reader name is separate from the label**: the other chips say where they go by saying
  their directory, and this one does not, so it announces `the workspace, <path>`.

### Fixed

- **Two header chips shared a poll by copying it, and the copies had drifted** ([#141](https://github.com/receptron/mulmoterminal/security/code-scanning), the repository's only open code-scanning alert).
  `useGitStatus` and `useWorkItem` each carried the same visibility-aware polling lifecycle — mount,
  window focus, a tick, and the matching teardown. Extracted into `usePollWhileVisible` rather than
  suppressed, because the drift was the interesting part: only `useWorkItem` listened for
  `visibilitychange`, added there in review because switching browser **tabs** fires that and not
  `focus`. So **the git chip showed a stale branch on a returning tab** until its next tick. One
  definition fixes that as a side effect, which is the argument for extracting over ignoring.

  `remoteHostSelfHeal.ts` keeps its own copy of the visibility check deliberately: it is not a
  composable, it also heals on `online` and on a socket reconnect, and its tick is unconditional
  because a heal is a no-op when already connected. Said so in the new file, so the next reader does
  not fold it in.

  Measured with the jscpd version CI pins (5.0.12 — the `npx` default reports a different set): one
  clone on main at `useGitStatus.ts [30:69 - 43:56]`, 59 tokens, which is the alert's exact span, and
  zero after. The alert closed on the first scan of main.

### Docs

- The 4.3.0 changelog's setup-guide link text now matches that page's own title, as every earlier
  entry does.

## mulmoterminal@4.3.0 — 2026-08-04

> **Setup guide:** [The workspace is one place, and an Enter that means 変換](https://receptron.github.io/mulmoterminal/guide/en/v4.3.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.3.0.html))

Two things you can see. **The workspace now behaves as one place** rather than four: whichever way
you start a terminal there — a claude cell, a codex cell, or a launcher chip — it reaches the same
GUI tools, and the launcher always offers the workspace as its first chip instead of leaving it to
the recently-used list. And **an Enter that confirms a Japanese IME candidate stays with the IME**,
in the session note and in the terminal, on every browser.

### Added

- **The launcher always offers the workspace, and says what it is** ([#1359](https://github.com/receptron/mulmoterminal/pull/1359)).
  The chip row was `cwdPresets` verbatim — a list `recordPreset` fills in as you launch things, and
  one the user can delete entries from. So the single most important directory was **missing until
  you had launched there once, and gone for good if you ever pressed its ×**. It is now synthesised
  in front of the list: always first (outside `orderByDirPriority`, which ranks the directories a
  user configured against each other — the workspace is not in that competition), never duplicated
  when it is already a preset, and keeping the label the user gave it. With `defaultCwd` unresolved
  it adds nothing, rather than offering a click to a directory nobody chose.


  It carries the `workspaces` icon and no × — a synthesised entry has nothing to remove, and
  removing it would only bring it back on the next render. The frame and background are deliberately
  **untouched**: those already mean "a session is running here", and [#1106](https://github.com/receptron/mulmoterminal/issues/1106)
  was that exact doubling-up reported as a bug.

### Changed

- **In the workspace, every way of starting a terminal reaches the same GUI tools** ([#1358](https://github.com/receptron/mulmoterminal/pull/1358)).
  `carriesFullGuiMcp` only looked at claude cells, so four terminals in **the same workspace
  directory** had four different tool sets depending on how they were started — a codex cell got
  only the groups registered for the directory, and a `claude` launcher chip got **nothing at all**,
  so the Canvas never appeared. The cell beside you had tools you did not, for no reason you could
  see.


  The predicate moved from `spawn-claude.ts` to `mcp-config.ts` — it now has three callers (claude's
  argv, codex's `-c`, a chip's command line), and living inside the claude spawner is what let the
  drift happen. Two costs are accepted rather than hidden: codex approves MCP servers **per server**,
  so an all-tools URL auto-approves external accounts and paid generation in one go (already true
  for claude in the same cell — what closed is the asymmetry); and a `claude` chip is given
  `--strict-mcp-config`, so **that terminal does not load the user's own MCP servers**. Both are in
  the README.

- **The single-view GUI MCP server id is `mt`** ([#1355](https://github.com/receptron/mulmoterminal/pull/1355)).
  An MCP client always qualifies a tool with its server id — `mcp__mulmoterminal-gui__presentChart`
  for Claude Code, `mcp-mulmoterminal_gui-presentChart` for Codex — and that id is paid **once per
  tool, on every listing, for the life of the session**. Seventeen characters repeating what the
  surrounding config already said.

  Only this id moved. The per-group ids (`mulmoterminal-render`, …) are **keys in `.mcp.json` files
  users wrote**, and renaming those breaks working setups silently; that needs a migration, not an
  edit. So the same tool is `mcp__mt__presentChart` in a workspace cell and
  `mcp__mulmoterminal-render__presentChart` in a project cell — deliberate, and now written down in
  the README, in both constants, and in CLAUDE.md so it is not "fixed" later.
  `LEGACY_GUI_SERVER_IDS` keeps recognising our own past output, which matters in two places: the
  reserved-id list, and the Antigravity config merge that deletes our entry by id (without it,
  `mulmoterminal-gui` would sit in `.agents/mcp_config.json` forever).

### Fixed

- **Enter confirms the IME candidate instead of saving the note half-converted** ([#1353](https://github.com/receptron/mulmoterminal/issues/1353)).
  Typing れびゅー, converting to レビュー and pressing Enter to accept it saved the **unconverted**
  text and closed the box — and with the box gone there was no second chance. Reported by
  @mikkegt, who also spotted that Escape had the same hole; it did, and it was worse, since Escape
  mid-composition means "drop this candidate" and it was discarding the whole sentence.

  The `isComposing` guard the rest of the repository uses is not enough on its own: **Safari fires
  `compositionend` BEFORE the confirming keydown**, so the flag is already false when the handler
  runs. Chrome and Firefox fire it after, which is why they looked correct. MulmoClaude had answered
  this already with a short window after `compositionend`; that composable is ported here with its
  shape and constant intact, so someone running both apps does not get two behaviours from one
  keypress.

- **The same gap in the terminal, where it cost more** ([#1364](https://github.com/receptron/mulmoterminal/pull/1364)).
  The four guards the report pointed at — `terminalSubmit`, `keymap`, `terminalClipboard`,
  `gridShortcut` — are pure `(keymap, event)` functions, so `e.isComposing` is all they can see and
  Safari's ordering is invisible to them by construction. On Safari an Enter meant to accept 変換
  **submitted the half-converted line to the agent**. Composition is now tracked at the DOM boundary
  (`imeComposition.ts`, capture-phase on `window`) and the call sites ask; two insertions cover all
  four, because three funnel through one xterm handler. The pure guards stay — they are right for
  Chrome and Firefox, and this sits in front of them.

  A first cut of that tracker had a worse failure than the bug: module-level state that never reset,
  so a composition abandoned without its `compositionend` (a tab switch, an input torn down
  mid-word) left every later keystroke suppressed — no shortcuts, no terminal Enter — until reload.
  Caught in review; it resets on losing focus now, with a regression test for each path.

- **The test suite stopped leaving temp directories behind** ([#1345](https://github.com/receptron/mulmoterminal/issues/1345)).
  Measured at **51 per full run, now 0**. The machine it was found on had 42,000 `mt-*` entries in
  `$TMPDIR`, enough that `readdir` on it took 5.4s. `makeTempDir` only ever created, so all twenty
  callers leaked by construction; it records what it hands out and a setup file removes the lot when
  the spec file finishes. Two leaks the registry could not reach were traced individually: the
  rate-limit probe's directory is created by PRODUCTION code (which removes it correctly — the tests
  asserting the probe is still running never stopped it), and one spec's HOME **came back after
  deletion**, because `appendSessionToolGroup` is fire-and-forget and begins with `mkdir` recursive.
  `registry.ts` gained `whenToolGroupsPersisted()` so a caller can wait for a queue it otherwise had
  no handle on.

### Changed — tooling

- **Three files belonged to no tsconfig project at all** ([#1348](https://github.com/receptron/mulmoterminal/issues/1348)).
  `scripts/model-trials.ts`, `test/helpers/appRequest.spec.ts` and `vitest.config.ts` were checked
  by nothing — not `yarn typecheck`, not `build`, not CI. `tsconfig.node.json` naming `vite.config.ts`
  by filename was the cause, so it takes a pattern instead, and `test/helpers` is claimed as a
  directory (its browser half excluded by name, since it wants DOM types). Checking the orphaned
  spec immediately found four unused parameters in it. Verified by planting a type error in each of
  the three and confirming it is caught — 1,173 tracked files, 0 uncovered, because clean is not
  evidence of checked.

  `noImplicitReturns` goes on for app and node, measured at 0. It stays **off** for the server,
  decided rather than deferred again: 31 findings here and 27 more in test-server re-checking the
  same files — #1301's recorded 58, unchanged — across 33 Express handlers, every one of them
  `if (bad) return res.status(400).json(…)`. That is how an Express handler is written; rewriting 33
  of them to silence a house-style report buys no safety. `tsconfig.server.json` says so in place.

- **`sonarjs/void-use` is an error, and the reason it was off was not true** ([#1362](https://github.com/receptron/mulmoterminal/issues/1362)).
  It had been off since 4.2.0 on the reasoning that it forbids the `void` that `no-floating-promises`
  asks for. It does not: S3735 returns early for a thenable, for `void 0`, for an IIFE, and for a
  call it cannot type — and with no type information at all, for any call. Turning it on reported
  **three** findings, all in `tmux-size-sync.ts` and none of them a promise. Those are block bodies
  now and the rule is an error. It reported nothing against the **163** other uses of the operator
  in `server/`, `src/` and `common/`, the sixty-six from #1300 among them — which is the point: the
  two rules never fought, so nothing had to be chosen between them.

### Docs

- **The pages are named for what people search for** ([#1352](https://github.com/receptron/mulmoterminal/pull/1352)). The
  content was already there and the titles were not: "Basics" is where
  `run multiple Claude Code sessions` is answered, "Scenarios" is where
  `Claude Code worktrees` is. Nine pages per language retitled in frontmatter only — **not one word
  of body text changed** — plus a comparison page and a `facts.json`.
- **Every cell is a real pty** ([#1360](https://github.com/receptron/mulmoterminal/pull/1360)). The app is a terminal and an
  agent is one of the things you run in it; the code says so and the README did not. Which is also
  the missing explanation for why the one-session-per-worktree limit applies to **agents only** — a
  shell or a `yarn dev` can sit in the same worktree an agent is working in. Added to the README and
  to the FAQ's tmux answer, in both languages, without touching the existing headings.
- **Which Claude sessions carry the whole GUI MCP** ([#1354](https://github.com/receptron/mulmoterminal/pull/1354)). The README read as
  though every spawn got it. The guide had been corrected in #1309; the README had not.
- **How the workspace directory is settled** ([#1346](https://github.com/receptron/mulmoterminal/pull/1346)): `--cwd`, then
  `CLAUDE_CWD`, then where you ran it — written as an order rather than a list of things that "take
  precedence", in both languages.
- **Who builds this** ([#1349](https://github.com/receptron/mulmoterminal/pull/1349)), which the README never said.
- **The 4.2.0 guide's two visual changes have screenshots** ([#1344](https://github.com/receptron/mulmoterminal/issues/1344)),
  the pane expansion as a before/after pair because a single frame cannot show a width change. The
  hero GIF was retaken now that `done` is green on a tile too ([#1340](https://github.com/receptron/mulmoterminal/issues/1340)).

## mulmoterminal@4.2.0 — 2026-08-03

> **Setup guide:** [Self-hosted GitLab, panes that take the whole terminal, and worktrees that keep their colours](https://receptron.github.io/mulmoterminal/guide/en/v4.2.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.2.0.html))

Four things you can see: a self-hosted GitLab works by naming it in one config key, the Canvas and
Tools panes can take the whole terminal area, a new worktree keeps the project's colours instead of
arriving blank, and a terminal that has stopped accepting input either repairs itself as you type or
says why it cannot. Underneath, the two type-safety programmes ([#1300](https://github.com/receptron/mulmoterminal/issues/1300),
[#1301](https://github.com/receptron/mulmoterminal/issues/1301)) are finished: **407 `no-unsafe-*`
findings are zero and the rules are errors**, `noUncheckedIndexedAccess` is on, and `yarn typecheck`
finally looks at the whole repository rather than two fifths of it.

### Added

- **A self-hosted GitLab works once you name it** (#1332). `gitlab.hogefuga.com` used to get one
  sentence saying MulmoTerminal reads github.com and gitlab.com, and nothing else. Declare the host
  in the global config and it goes down the same path gitlab.com does — the PRs & Issues lists,
  starting work from an issue, work comments, and creating a merge request:

  ```json
  { "gitlabHosts": ["gitlab.hogefuga.com"], "prRepos": ["gitlab.hogefuga.com/group/project"] }
  ```

  An undeclared host now names the key to add rather than just refusing. `--repo` is passed as a
  full https URL for **every** GitLab host including gitlab.com, which is not tidiness: measured
  against glab 1.111.0, `--repo gitlab.nonexistent.invalid/group/project` asks **gitlab.com** for a
  project by that name and 404s, so the short host-qualified form silently queries the wrong server.
  `github.com` is rejected as a value, since it is an easy thing to write and an expensive thing to
  get wrong. Not covered: ports (`prRepos` entries cannot hold a colon), http-only instances, and
  GitHub Enterprise. The host list is read from the in-memory config, so an edit through Settings
  applies at once while a hand-edited `config.json` needs a restart — the same rule `prRepos`
  already follows. There is no Settings UI for it yet, by request.

- **The Canvas and Tools panes can take the whole terminal area** (#1333). The expand button in each
  pane's header (`open_in_full` / `close_fullscreen`) gives the pane the entire zoom row while it is
  held. It covers **only the enlarged terminal** — the cockpit roster to the left and the filmstrip
  below sit outside that row and do not move, verified in both zoom modes. The terminal is moved
  off-screen at full size rather than hidden, because an xterm with `display: none` shrinks to zero
  and comes back mangled (the same reason as #1125, and the same trick list mode already plays on the
  tiled grid). Tools gained the identical button pair in the identical position, since two panes
  sharing one slot must not need to be learned twice. Canvas also gained a Close at the right end,
  matching Files and Tools, and lost its tools button — the Tools pane still opens from each cell's
  own header.

  **The expanded state is deliberately not remembered.** The first cut persisted it, and reopening
  the pane then restored it on top of the terminal: a pane over the terminal is a surprise every time
  except the moment you asked for it, and what it hides is the thing being worked on. It resets on
  every `setRightPane` — reopening the same pane, switching panes, or reloading all start split.
  Which pane was open and how wide it was are remembered as before. Canvas and Tools share the state,
  so at most one thing ever covers the terminal.

- **A new worktree inherits the project's settings, one hue step off** (#1317). `.mulmoterminal.json`
  is normally gitignored, so `git worktree add` produced a directory with no config in it at all:
  the cell lost the project's colours, name badge, model and grid rank, and — being unranked — fell
  to the end of the priority sort. Three cells of one project looked like three unrelated ones. A
  worktree is now given its own config derived from the project's: `name` / `theme` / `colors` /
  `fontSize` / `fontFamily` / `provider` / `model` copied as written, the seven chrome colours
  rotated **12 degrees further around the hue wheel per worktree** so a project's trees read as a
  gradient, and `orderPriority` at the project's rank **+ 1** so each sits directly after the
  project it was cut from. Hue only, because saturation and lightness carry the contrast a colour
  was chosen for — which also means a grey like `headerTextColor: "#ffffff"` has no hue to move and
  survives untouched, with no special case. `sound` / `sounds` / `addDirs` are deliberately not
  carried: they name paths inside the project directory that the worktree has no copy of, and
  `addDirs` resolves against whichever directory holds the file, so copying it would quietly grant
  a different set of folders. Written only where git would **ignore** the file — an untracked file
  in a worktree's `git status` is not merely untidy, since `isDirty` reads that same status and
  MulmoTerminal refuses to remove a dirty worktree, so the app would have blocked cleanup over a
  file it wrote itself. An existing config in the worktree is never overwritten. The write happens
  inside `createWorktree`, so the launcher's **＋ New worktree** and the issue-started path both get
  it rather than one of the two.

### Changed

- **A finished turn is green in the grid too, not just in the roster** (#1307). The four attention
  states are painted in two places — the grid cell paints its own chrome, the cockpit roster row
  paints its own (they are different components on purpose; see `docs/grid-view-modes.md`) — and
  they disagreed about exactly one state. `blocked` was amber on both sides, `idle` neutral on
  both, but `done` was the theme **accent** on a cell and **green** on a roster row. Two costs:
  `working` is also the accent, so on a tile the two blues were hard to tell apart at the distance
  you actually scan a grid from; and enlarging a session changed the colour of "this one finished"
  under you, so the state colours never became something you knew without thinking. The cell's
  `done` frame, ring, header wash and dot are now the same green, giving **working = blue, done =
  green, waiting = amber** in every view. The green moved to one `--done` token that the cell, the
  roster row, the roster/thumbnail dot and its pill all name, so the two sides cannot drift apart
  again, and a spec holds them to it. The toolbar's `done` tally went green as well — via `--ok`
  rather than `--done`, because that one is text and `--done` is a fill colour that reads at 2.3:1
  on a white panel. The roster is unchanged: its green is what everything else moved to.

### Fixed

- **A terminal that will not take input now repairs itself as you type, or says why it cannot**
  (#1306). Two different paths swallow keystrokes in silence, and both look identical from the
  outside — "input is broken."

  The first is xterm 6.0.0's `Buffer.resize` bug ([xtermjs/xterm.js#6063](https://github.com/xtermjs/xterm.js/issues/6063),
  still open upstream, so the version is pinned): the write queue jams permanently, keystrokes keep
  reaching the pty, and nothing that comes back is ever drawn again. The repair already existed
  (`guardBufferHealth` → `rebuildTerminal`, #848), but it was only reachable from `fit()` and from
  receiving an output frame — and an **idle** cell gets neither. The cell most in need of repair was
  the one least able to ask for it, so it stayed dead until a reload. Typing is the one signal such a
  cell does receive, and it is now a third trigger. Pointer reports are excluded via `isTypedInput`,
  the same reading of "input" as everywhere else (#992).

  The second is a keystroke sent to a socket that is not `OPEN` — during reconnect backoff, or after
  `superseded`. It was dropped without a word. The status pill did say `disconnected`, but the header
  carrying it is hidden in the filmstrip, and nobody watches a pill while typing. The manager now
  tells the view and a temporary banner appears, with a matching `console.warn` that distinguishes
  the two silences after the fact: socket down, or terminal stopped drawing.

- **The dropped-input notice reaches every path, and says so again when it lapses** (#1315, #1316).
  Follow-ups found while reviewing #1306. `submitText` / `pasteText` / `pasteAndSubmit` merely
  returned `false` on a closed socket, and only `TerminalCell.vue` looked at the return value — the
  header buttons and the Skill menu discarded it, so **pressing them while disconnected did nothing
  and explained nothing**. The notice moved into the manager, so no call site had to change. The
  banner was also armed once per disconnect and only reset on `sock.onopen`; backoff retries
  indefinitely at a five-second ceiling, so one stretch can run for hours while the banner lives six
  seconds — every attempt after the first was silent. It now re-arms on a cooldown equal to its own
  lifetime, while the log line stays one per stretch. The wording moved from "what you typed" to
  "what you sent", because someone who pressed a button did not type.

### Changed — dependencies

- **gui-chat-protocol 2.0.0**, with exactly one copy in the tree (#1342). 2.0.0 removes the
  return-position-only type parameter from `dispatch` / `subscribe` / `getConfig` and takes a reader
  instead, so MulmoTerminal's `BrowserPluginRuntime` had to follow; `@mulmoclaude/*` (core and eight
  plugins) and `@mulmochat-plugin/generate-image` all move to 2.0.0 with it, and
  `@receptron/task-scheduler` to 1.0.3 to satisfy core's peer range. One copy is a requirement rather
  than tidiness: `PLUGIN_RUNTIME_KEY` is a Vue `InjectionKey`, so two copies are two Symbols and a
  plugin View cannot receive the runtime the host provided.

  The `dispatch` half is **not reachable by typecheck** — TypeScript relates overloaded targets
  leniently, so the old `as T` implementation still compiled against the new signature while
  ignoring a caller's `parse` and returning raw JSON. Its behaviour is pinned by tests instead.
  `subscribe` also gained a guard that drops an unparseable frame rather than the channel: the reader
  idiom the protocol documents is `Schema.parse(raw)`, Zod's `parse` throws, and without the guard one
  malformed frame would take every other subscriber on that channel down with it. Removing the guard
  turns its test red.

- **`@mulmoclaude/markdown-plugin` 1.6.0** (#1324), with `@mulmoclaude/core` raised alongside it.
  Bumping the plugin alone installs and typechecks cleanly — and ships **two** copies of core,
  because yarn satisfies the plugin's newer range with a nested one.

### Changed — type safety

[#1300](https://github.com/receptron/mulmoterminal/issues/1300) and
[#1301](https://github.com/receptron/mulmoterminal/issues/1301) are both closed.

- **`no-unsafe-*` went from 407 findings to zero, and the five rules are errors** (#1321, #1325,
  #1326). Server first (145 → 0), then the UI (262 → 108, then 0). Excluding `.vue` was not enough:
  four `.ts` files that import a type **from** a `.vue` inherit the same blind spot, and the
  exclusion list now names which `.vue` each one imports. Real defects fell out — `createSessionStore`
  gained a required `isEntry` (optional would have defaulted back to "accept everything"),
  `useAppConfig.loadConfig` now rejects a broken entry at load rather than only at save, and
  `TerminalCell`'s `SessionDetail` type was deleted because `/api/session/:id` does not return `id`,
  which four failing tests revealed the moment a guard was added.
- **`noUncheckedIndexedAccess` is on for the shipped code, all 118 findings fixed** (#1301). #1301
  had estimated 445 and called it separate work; measured against the app it was 118, every one
  mechanical. Specs are explicitly exempt — a test indexing its own fixture is noise, and that is 233
  of the findings. It also **removed** lint false positives: `sonarjs/different-types-comparison`
  fell 9 → 4, because a guard like `process.argv[2] === undefined` only looked impossible while the
  flag was off.
- **The `as` and `!` bans now reach Vue templates** (#1339). `consistent-type-assertions` was already
  an error with `**/*.vue` in `files`, and had **never once reported** an `as` inside `<template>`:
  `vue-eslint-parser` exposes the template as a separate AST that typescript-eslint's rules do not
  walk. Written as `vue/no-restricted-syntax` selectors, the only rule that walks it. Two findings
  repo-wide, both resolved by narrowing in `<script>` rather than casting; `as const` is exempt.
- **The eight type-aware sonarjs rules were judged one finding at a time** (#1300). Eighteen findings
  read individually: three real, fifteen false positives or deliberate. The false positives are
  **structural**, so the rules are off rather than each finding suppressed. sonarjs warnings 18 → 5,
  total lint warnings 23 → 10.
- **`await-thenable` and `no-base-to-string` at error** (#1300), all 19 findings fixed.
- **Sixty-six unawaited promises are marked `void`** (#1300), warnings 102 → 33. None was a real bug;
  the value is that the next floating-promise warning means somebody actually forgot an `await`.
  `sonarjs/void-use` is off, since it forbids exactly what `no-floating-promises` asks for.
  **Corrected in [#1362](https://github.com/receptron/mulmoterminal/issues/1362):** that last sentence
  was wrong. The rule excludes promises, so it never saw any of these sixty-six, and it is an error
  again — see the Unreleased entry above.
- **Type information reaches `.vue`** (#1300), which made `no-floating-promises` visible in SFCs for
  the first time (34 → 66 findings). The wiring is two edits and one of them is a trap: naming `.vue`
  in the type-aware block's `files` replaces `vue-eslint-parser` and every SFC fails to parse.
- **Filename sorting is explicit and locale-independent** (#1300). `localeCompare` would have been
  wrong here: these are zero-padded date directories and ISO timestamps, so a locale-ordered sort
  gives a different answer per machine.

### Changed — tooling and tests

- **`yarn typecheck` covers the whole repository** (#1312). It had been looking at `app` and `node`
  only — **server and test were never checked**, which is what the CLAUDE.md warning about "passes
  locally, fails in CI" existed to paper over. Root `references` went 2 → 5, `typecheck:server` and
  `typecheck:test` are gone, and CI's three steps collapsed to one. Proven by planting a type error
  in each of the four areas and confirming all four are caught; the old config reported **0 errors**
  for the same server error. It is also slightly faster cold (13.3s vs 14.1s), because `-b` shares
  work across projects.
- **153 server specs run in the node environment** (#1331). They touch no DOM but were standing up
  jsdom anyway. One line each, no test bodies changed. Measured at `--maxWorkers=4` to mimic the CI
  runner: median duration 84.30s → 62.88s, median `environment` time 181.32s → 104.70s.
- **The first test in a file no longer pays for module loading** (#1314). `await import("…/Foo.vue")`
  inside an `it` pulls the component's whole module graph through the transform and bills it to that
  test's `testTimeout`. `GridView.spec.ts`'s first test measured import=2132ms against mount=18ms.
  Four specs went from 27.5s to about 0.1s combined; `cellChromeColors.spec.ts` alone was 11084ms
  with a 15s limit, and was the next thing due to turn CI red.
- **Route specs no longer make socket round-trips** (#1314). `presentPathRoot.spec.ts` tested
  deterministic middleware through eight unnecessary round-trips, which spin the event loop orders of
  magnitude more than a plain assertion and made it the first casualty of a busy runner. Thirteen of
  the fourteen hand-rolled `app.listen(0)` specs moved to an in-process helper.
- **`probe-transcript.spec.ts` gets a budget matched to what it measures** (#1328). It writes 601
  files and reads them back — 1200 real disk operations this process does not control — against a
  15s default. Now an explicit 60s, about six times the worst observed 9.7s, so a genuine hang is
  still caught. The 601 stays: it is the claim the test makes.

### Docs

- **Which directory to launch a cell in** (workspace vs project), in both languages — a question with
  the answer scattered across a config table, an environment-variable table and a 2.8.0 release page,
  and absent from all three places a reader would look (#1309).
- **The worktree close dialog** now has screenshots and prose in both guides; the creation side was
  documented and the cleanup side was not (#1322). Capturing it turned up a rule worth keeping:
  `deviceScaleFactor: 2` bakes xterm's glyphs at double size, so any shot containing a terminal has to
  be taken at 1.
- **The hero GIF matches the current 4.1 UI** (#1305), re-shot as a 3x3 grid of live sessions,
  enlarging one, typing, and returning.

## mulmoterminal@4.1.1 — 2026-08-02

> **Setup guide:** [Usage that stops saying n/a, and 300 lines of scrollback on the phone](https://receptron.github.io/mulmoterminal/guide/en/v4.1.1.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.1.1.html))

A maintenance release. The visible parts are a usage figure that no longer sticks at `n/a`, a phone
terminal you can actually scroll back in, and GitLab worktrees reaching parity with GitHub ones.
The bulk of it is invisible: 149 type assertions removed from the app, and the rule that forbids
them promoted to an error.

### Fixed

- **The header's usage figure could stick at `n/a` forever** (#1298). The rate-limit probe typed its
  question into the TUI blind — open it, wait a fixed moment, send keystrokes. On a machine where
  the TUI needed longer than that moment (slow disk, large MCP config, cold cache) the keystrokes
  landed before anything was listening, so the question was never asked and no answer came back.
  Every later probe repeated it, which is why the state was permanent rather than intermittent. The
  question is now a positional argument to `claude`, and the probe runs with `--strict-mcp-config`
  so a user's own MCP servers are not loaded just to answer it. Diagnosed by measuring on real
  hardware rather than from the rendering side, where the symptom appeared.
- **Windows CI had been red on every run since #1226** (#1269). One assertion in
  `presentPathRoot.spec.ts` spelled a session cwd in a way the platform does not.

### Added

- **The phone's terminal returns 300 lines of scrollback** instead of the visible pane (#1274).
  Both the tmux path and the headless fallback ask for the same history, and the window is decided
  in one place, so a host with tmux and a host without it answer identically for the same session.
  A 256 KiB ceiling accompanies the line count: the reply travels in a Firestore command document,
  and "bounded by rows × cols" stopped holding once history was included.
- **GitLab worktrees reach parity with GitHub ones**, completing #981:
  - The **PR phase pill** appears for a GitLab merge request, and its hover tip explains *why* a
    merge request cannot be merged — something the phase alone cannot express (#1283).
  - **⧉ Open PR** creates the merge request, opens the existing one on a second press, and writes
    `Fixes #N` plus the clone footer into the body (#1279).
  - **Work comments** (`issueWorkComments`, off by default) post on start and on merge, and close
    the issue on merge — previously a no-op on GitLab repos (#1271).
  - `doctor` now checks for `glab`, and the docs that still claimed GitHub-only were corrected
    (#1287). `gh` remains required; `glab` is optional.

### Changed — type safety

Eleven pull requests finished [#1231](https://github.com/receptron/mulmoterminal/issues/1231):
every `as` type assertion is gone from the app, and
`@typescript-eslint/consistent-type-assertions` is now an **error** with a two-file allowlist, each
entry naming the upstream defect that would remove it.

Removing them surfaced real defects, not only untyped code:

- A config save whose validator named fields the interface does not have, so **saving quick
  commands or MCP servers emptied the list** (#1294). Caught in review; a round-trip test now pins it.
- `marked.parse(…) as string` could put the string `"[object Promise]"` through DOMPurify and into
  a rendered page (#1276).
- The presentHtml dispatch asserted its arguments past the package's own guard — the one whose
  contract says a non-string `html` **blanks the artifact** (#1296).
- `isUuid()` could be handed a non-string from persisted grid state (#1280).
- A remote-host payload asserted to be JSON is now converted through `JSON.stringify` itself, so
  the claim holds by construction rather than by imitation — after four rounds of review found
  divergences (`__proto__` keys, `Date`, the key passed to `toJSON`, boxed primitives) (#1288).
- `mergeSessionMeta` validated one field of a response and trusted the other four (#1282).

Other entries: #1273, #1278 (took the upstream fix from
[mulmoclaude#2721](https://github.com/receptron/mulmoclaude/pull/2721), which widened
`modalTeleportTarget` so a Shadow-DOM host no longer needs a cast), #1291, #1297, #1299.

### Changed — tooling

- **Two strictness flags** (`useUnknownInCatchVariables`, `noImplicitOverride`) and the `strict`
  that `tsconfig.node.json` was missing (#1302, part of #1301). The other three flags #1301 listed
  are **not** free — measured the way CI runs them, `noUncheckedIndexedAccess` costs 445 findings
  and `noPropertyAccessFromIndexSignature` 1,785 — so they stay open with the numbers recorded.
- **`no-floating-promises` and `no-misused-promises`** now run with type information, at `warn`
  (#1302, part of #1300). Enabling the type program also woke eight sonarjs rules that were already
  configured as errors but had never run; they are at `warn` pending #1300.
- **Duplicate code removed** — the four jscpd alerts are now zero, with unit tests on the extracted
  helpers (#1290, #1289).

### Docs

- **[Getting started](https://receptron.github.io/mulmoterminal/guide/en/getting-started.html)** is
  a new first page for the guide, taking a reader from an empty machine to a running
  `npx mulmoterminal@latest`. The sidebar now puts the beginner path first (#1295).
- The zoom-plus-Canvas screenshot the single-view removal had left missing (#1232).

## mulmoterminal@4.1.0 — 2026-08-02

> **Setup guide:** [GitLab in the PRs & Issues view](https://receptron.github.io/mulmoterminal/guide/en/v4.1.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.1.0.html))

The **PRs & Issues** view reads gitlab.com as well as github.com, and a GitLab issue starts work
the same way a GitHub one does. Nothing about an existing setup changes: a bare `owner/repo` still
means github.com, and no new configuration is required.

### GitLab in the cross-repo lists (#981 steps 1, 2a, 2b, 4a, 4c-1)

Five PRs, built in the order the pieces have to exist. Each one is a layer the next depends on.

**Tell an unsupported forge from no remote at all (#1217, step 1).** `parseGithubWebUrl` answered
`string | null`, and that null travelled to six call sites meaning two different things — "this is
a GitLab repo" and "this directory has no origin". Every feature downstream read it as "no GitHub
here" and removed itself, so a user on another forge got silence rather than an explanation. A new
layer answers `{ host, kind, path, webUrl }`; the 45 existing specs pass untouched, which is the
evidence the behaviour did not move.

**Let `prRepos` name its host (#1221, step 2a).** `gitlab.com/group/project` can now be stored —
`REPO_RE` allowed exactly two segments before, so the information could not even be saved. A first
segment containing a dot is the host; GitHub owner names may hold only alphanumerics and hyphens,
so the two forms cannot be confused. The "unsupported" message needed no new UI: `RepoPrs` and
`RepoIssues` already carry a per-repo `error`, the channel a failing CLI call uses.

**One place decides what repository a directory names (#1230, step 2b).** Five call sites each
wrote `repoFromWebUrl(await resolveGithubUrl(dir))`, with the same two-meanings-of-null problem.
Behaviour unchanged; what is new is that the forge sits beside the answer.

**Read GitLab merge requests and issues (#1246, step 4a).** Four things the real API taught, none
of which a type would have caught: `iid` and not `id` (which is unique across the instance and
appears in neither the UI nor the URL); `web_url` as given, since GitLab is moving issues to
`/-/work_items/`; `-F` means the output format on `mr list` and something else entirely on `issue
list`; and `issue list --opened` is deprecated, which running it says and the help does not.

**Start work on a GitLab issue (#1260, step 4c-1).** Two holes only running it end to end could
show: a GitLab clone was absent from `/api/repo-dirs` (correct when written, wrong the moment work
could start on GitLab), and the route stripped the host before calling down, so `group/project` read
as a GitHub repo. Both were one string carrying two jobs, now split — `repoIdentity` keeps the host
for matching a configured entry to a clone, `canonicalRepo` strips it for a CLI's `--repo`.

**The known limit:** a GitLab row's CI dot is usually blank. The merge-request list carries no
pipeline, and reading it costs one call per merge request — more than a cross-repo view can spend.
Widening `CiState` would express it but would change how GitHub rows render, which this release
deliberately does not do.

### One worktree per issue (#1219, #1222)

Starting work on the same issue twice created `issue/<N>-<slug>-2` silently. The second attempt now
opens what exists: reuses the worktree when no session is in it, opens the existing session when
there is one, and declines with a sentence naming the next action when somebody else holds it. The
`-2` suffix itself was correct code and is kept — it is what prevents two DIFFERENT tasks colliding.

### Header tooltips are immediate, and say more (#1235, #1247)

The cell header used the browser's own `title`. Both of its limits are unfixable: the delay before
it appears is browser behaviour that neither CSS nor JavaScript can change, and it holds one line of
plain text with nowhere to put what a chip had to truncate. Replaced with the app's own tooltip.

The work chip now shows the PR and issue TITLES — `prTitle` and `issueTitle` have arrived from the
server since #1014 and had been parsed and then never displayed, so a row reading `#2689 → #2688`
could not tell you what either was about.

### Fixes

**The header's git and work chips rendered in serif (#1251, #1252).** This app declares no font on
`<body>` and applies utilities per element, so an element that forgets falls back to the browser's
serif. Measured in a real browser rather than eyeballed: six elements were falling back, and these
two were the only ones in the header with no declaration.

**A Windows path read by POSIX rules in the session registry (#1213).** The registry's filesystem
doubles split paths the POSIX way, so a session could be recorded against the wrong directory.

**A NUL byte made a module invisible to grep (#1254).** `startIssueWork` built its lock key as
`${dir}<NUL>${issue}` with the byte written literally rather than escaped. The code was correct;
what it broke was reading the repository — a file holding a NUL is binary to `grep`, which skips it
SILENTLY, so three separate "every file that calls X" sweeps read every module except that one and
reported totals that were wrong without saying so. Three more files turned out to hold literal ESC,
all of them specs holding pasted terminal output. A test now checks the bytes.

### Phone

**Start work from an issue on the phone (#1184, #1216).** The host-side commands for listing issues
and starting work on one, with the constraint the protocol already documents: the phone never sends
a path, so the clone comes from what the server resolved rather than from the request.

**Run the seed, rather than leaving it in the box (#1255).** A phone has no Enter key to press, so a
seeded prompt sat there. `startIssueWork` takes `run`, which spawns with the prompt as an
`initialPrompt` — the existing injection path waits for the input box and submits it. The reply's
`ran` says the session was started to submit, not that a keystroke has landed; the typing happens
after the reply, once the TUI has painted.

**Desktop and phone share one options object (#1261).** The two had drifted into separate spawn
paths for the same operation.

### Antigravity

**List a workspace's conversations (#1096, #1218).** `GET /api/antigravity/sessions?cwd=`, written
against agy 1.1.9 installed and inspected rather than a guessed format. The cwd does not come from
agy — it records a conversation's workspace in three places and none of them answers "every
conversation in this directory" — so it is read from this app's own log and agy's transcript is
opened only for a title and an mtime.

### Internal

**Over 130 `as` type assertions removed (#1231), across 18 PRs.** Every one replaced by a real type
guard, and the lint rule that forbids them is now on as a warning. Nothing changes on screen; what
changes is where a wrong shape fails — at the boundary it enters, rather than several layers later
with a confusing message.

## mulmoterminal@4.0.0 — 2026-08-01

> **Setup guide:** [The grid is the app](https://receptron.github.io/mulmoterminal/guide/en/v4.0.0.html) — written at release time. ([日本語](https://receptron.github.io/mulmoterminal/guide/ja/v4.0.0.html))

**Two things are removed in this release**, which is why it is a major: the **single terminal
view** and the **Docker sandbox**. Nothing you configured stops working — a stale `.env` key is
ignored rather than an error, and `/chat` lands on the grid instead of 404ing — but a screen you
may have bookmarked is gone, and everything it did now happens in the grid.

### The single terminal view is gone — the grid is the app (#1201, #1202)

Until 3.x there were two screens: the grid for supervising many agents, and a **single view** at
`/chat` for focusing on one, with its own toolbar, its own session sidebar and the GUI panel
(Canvas) on its right. That view is deleted. **Focusing on one agent is zooming its cell**, which
gives it the window and opens the Canvas beside it.

Everything the single view owned has a home:

| The single view had | It lives in |
|---|---|
| the settings modal | the grid's own |
| Canvas / tools panes | beside a zoomed cell |
| the session list | the cockpit roster, and the launcher's resume list for sessions off the grid |
| collections, wiki, accounting | the **Collections** door in the toolbar |
| one terminal filling the window | a zoomed cell |

**The content surfaces needed a door first**, and that is the other half of #1201. Collections,
Feeds, Wiki, Accounting and Files were gated to the single view — deliberately, because the grid is
for supervising agents and each of them replaces the whole screen anyway. With the view gone they
would have had no way in at all. **Collections now sits beside Grid** in the toolbar as a peer of
the views, and reveals Feeds / Wiki / Accounting / Files once you are inside: one button rather
than five, so a terminal user's row does not grow by four for surfaces they are not in. **Pull
requests is deliberately not content** — work under supervision belongs with the terminals.

Two things were found while building that door. **Feeds was showing the collection list** (the
overlay rendered the collections index for any index route, and that component filters feeds out);
it renders the feeds view now. **Pinned shortcuts moved** onto the row the overlay already had,
replacing the agent picker that was about to be deleted with the toolbar holding it — icon-only,
with the name still reaching a screen reader and the pointer.

**If you bookmarked `/chat`**, it now resolves like any other unknown URL: through `/`, to the
grid. Nothing errors.

### Everything the single view owned had to exist in the grid first (#1186, #1187, #1188, #1189, #1193)

The deletion above was the last step of a sequence, and each step is a change you can see.

**A workspace cell now carries the full GUI MCP (#1187).** One wire flag used to decide two
unrelated things — *is this a grid cell* and *does it carry the GUI MCP* — and the single view only
looked special because it answered both the same way. They are separated: `?gui=0` still means "a
grid cell", while the MCP decision reads `attachGuiMcp || isWorkspaceCwd(cwd)`. A terminal started
in the grid at the workspace is now all but the same thing as running the single view was. A cell in
a project directory is unchanged and loads its own MCP config.

**A chat started from a collection arrives with that collection already on the Canvas (#1186).**
You were looking at something when you started the chat, and that is the context; there is no
reason to blank it for the round trip until the agent calls `presentCollection`. The target is read
from the seed prompt rather than the route, because the route is already gone by the time the spawn
resolves — and the prompt travels with the chat.

**Sessions the server started while nothing was open are adopted by the grid (#1189).** An agent
calling `spawnBackgroundChat`, a scheduled task firing at 3am, the phone — three ways a *visible*
chat starts with no tab open. They used to land in the chat sidebar, which no longer exists. The
server marks them, and the next grid to load picks them up as cells.

**Full-screen surfaces open over the grid instead of replacing it (#1193).** Every overlay is
route-driven, so opening one left `/terminals` and the grid came off screen — with the single view
mounting behind it. The grid is now the view underneath, which is what let the view behind it be
deleted at all.

**Background workers are findable, and ungrouped tools stopped being hidden (#1188).** A truly
background chat has no cell and no bold row, so the launcher's session list is where it is found:
it is labelled `background`, and one that **ended without finishing a turn** is labelled `● failed`
— the only thing here nobody was ever told about, since it ran invisibly and pulled no attention on
the way out. Separately, `narrowedTools` used "is this a grid cell?" as a stand-in for "does it have
only what its directory registered?", which stopped being true once an adopted chat reported tool
groups and a workspace cell got the whole GUI MCP; an ungrouped tool such as `spawnBackgroundChat`
was dropped from cells that could call it.

### One worktree, one session (#1207, #1208)

A worktree is tied to a branch, so a second agent in it is not isolation — it is two agents editing
one working tree. The launcher's worktree rows are now three-valued: **start** one when the worktree
has none, **resume** the one it has, and **refuse** (`in use`) when that session is open somewhere.

**The refusal follows the directory, not the row.** The same worktree pasted into the working
directory field or picked from a recent-dir chip will not launch either, and the **server** refuses
the spawn whichever client asks — so a path spelled another way (a trailing slash, a symlink) does
not slip past. The limit is on **agents**: Claude, Codex or Antigravity, including an **OR LAUNCH**
command that runs one of them. A Shell, and a launcher running anything else, stays free — a
worktree an agent is working in is exactly where you want `yarn dev` or `lazygit`.

**"Open somewhere" is now the server's answer.** The launcher used to decide it from the current
page's own grid, which is blind to a second browser tab and to a second `mulmoterminal` process on
the same machine — the two ways a running session got taken over with nothing warning first. The
server answers from its own PTY table plus one `tmux list-clients` call.

**What you lose:** the resume list used to let you confirm your way past `● open` and take a session
over, detaching whoever had it. It now refuses instead. Close it where it is open, then resume it
here.

### Google Calendar collections actually sync (#1191, #1203, #1205)

MulmoTerminal never registered the Google Calendar sync task, so a collection that declared
`googleCalendar` had neither its **pull** nor its **autoPush** run. If you also ran MulmoClaude on
the same workspace, that host did it — which made this "works for people running both, silently
does nothing for MulmoTerminal alone". The task is registered now.

`@mulmoclaude/core` went to 1.12.0 for the prerequisite: a per-calendar `lastSyncedAt` in the
workspace, so `syncDueCalendarCollections` really does only the due ones rather than all of them.

### A cell tells you its PR merged, and offers to tidy up (#1026, #1185)

The pieces for cleaning up a worktree were already there; what was missing was anything that said
the PR had merged, so the worktree and its session sat until somebody noticed. A merged worktree
cell now says so in its header, and the button opens the **existing keep / remove confirmation** —
no new destructive path, and the same guards on unsaved and unpushed work as before. It shows only
on worktree cells (an ordinary cell has no room to clean up), has no default action, and the ×
dismisses it per PR number rather than forever.

### A scheduled task's chat is a background worker (#1196)

A task the scheduler runs — the dev worklog, or anything else you have configured — now behaves
like every other session nobody started by hand: it sits behind the **Background** filter rather
than among your chats, never renders bold, and **takes no grid cell**.

It was already half of one. Scheduled sessions have always been put on the background retention,
whose whole reason is that nobody is waiting for them to finish; only the chat list still called
them yours. The two agree now.

The grid part is the one you would have noticed: a visible spawn is adopted as a cell the next time
the grid loads, so an hourly task meant a cell per firing, indefinitely, without anyone asking for
a terminal.

**A failed one still tells you.** Being quiet is right while it works and wrong when it dies, so a
scheduled task that ends without completing a turn is recorded and shows as `● failed` in the
launcher's session list — the same signal a hidden `spawnBackgroundChat` gets. Turn the sound on
under Settings → Notifications if you want to hear it.

**Web Push still fires for it.** Being quiet means out of the chat list and off the grid, not
unreachable: a background session's finished turn normally never reaches the phone, on the
reasoning that it is not a real user task — and a task you configured to run while you are away is
exactly that. If you have push on, a scheduled task notifies as before.

**What you lose:** a scheduled task's session no longer goes bold/unread in the chat list when it
finishes. If you were watching for that, look under the Background filter, in the launcher's list
for the workspace — or turn push on.

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

It was opt-in, macOS-only, and only ever wrapped the single-view session — which this same release
removes. Keeping the sandbox would have meant porting it to the grid, which is the opposite of the
point: it existed to contain ONE interactive session, and the grid runs many.

Nothing else changes. With the flag unset — the default, and how it shipped — every session already
took the host path this now takes unconditionally.

### Fixes

- **A chat started from the Collection UI sat about ten seconds before its prompt appeared**
  (#1206). The prompt is typed into Claude's input box rather than passed as an argument (a long
  one overflows tmux's command-length limit), and the code waited for a readiness marker that never
  painted — for two reasons. The marker string was stale (`shift+tab to cycle` returns zero hits in
  the Claude Code 2.1.220 binary), and it was matched against raw PTY bytes, where a TUI redraws by
  positioning the cursor between words so the characters never arrive adjacent. Every spawn fell
  through to the 6-second quiet fallback. Markers are now matched against a squashed form of the
  stream, with escapes and whitespace removed.
- **A session started from the phone did not appear on the host until you forced a route change**
  (#1204). The server marked it for adoption and the grid only adopted on *arriving* at
  `/terminals` — which never happens while you are already sitting there. It now adopts on the push
  as well.

### Internal

- `@mulmoclaude/core` to **1.11.0** and then **1.12.0**, with five other dependencies refreshed
  alongside (#1190, #1203). 1.11.0 added two required fields to the calendar public types, which
  four spec fixtures had to follow; 1.12.0 needed no source change at all.
- The sandboxed-view **CDN allowlist** is imported from core instead of hand-maintained here
  (#1192). That list decides the `Content-Security-Policy` for every LLM-generated HTML this host
  serves, core declares itself its owner, and MulmoTerminal was the one host not following the
  declaration. The served headers were measured byte-identical before and after.

### Documentation

- **An FAQ page, in both languages** (#1209) — 21 questions each, written from four user
  interviews and the questions people actually ask before trying it: how it compares to VS Code,
  Cursor, tmux panes, Claude Squad and Conductor; whether existing Claude Code sessions carry over;
  Windows; token cost. Every factual answer was checked against the implementation.
- **"Open an issue, not a pull request" is reachable from the front door** (#1199). The policy was
  complete in `CONTRIBUTING.md` and enforced by a workflow, but the only things pointing at it were
  the changelog and a dated guide snapshot — so someone who read the README and wanted to help had
  no way to learn it before their PR was auto-closed.
- The living guide and README caught up with this release: the single view, the session sidebar and
  the resume-list confirmation are gone from them, and the GUI panel is documented where it now is.

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
