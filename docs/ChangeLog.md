# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

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
