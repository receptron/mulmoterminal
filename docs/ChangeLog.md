# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

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
