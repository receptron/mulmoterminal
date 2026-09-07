# CLAUDE.md — mulmoterminal

Working notes for AI coding agents in this repo. Human-facing docs (what it is,
install, features, full API/architecture) live in **README.md** — read it for
anything not covered here.

## Stack & package manager
- TypeScript. Web UI: **Vue 3 (Composition API)** + Vite (`src/`). Backend:
  **Express** + **node-pty**, run via **tsx** (`server/`). Shared code in `common/`.
- Package manager: **yarn** (yarn.lock). Use `yarn add`; don't hand-edit package.json.

## Run after changes
- `yarn format` — Prettier. `.prettierignore` excludes `*.md`, so Markdown is not reformatted.
- `yarn lint` — ESLint. There are two scripts and they are not interchangeable: `lint` pairs
  `--cache-strategy metadata` with `--concurrency auto`, which is what makes an unchanged run cost
  0 workers (auto counts only the files whose cached result is stale, and it can only do that
  under `metadata`). `lint:ci` uses `content` and no workers, because `actions/checkout` rewrites
  every mtime — and `content` makes auto count ALL files, so the two together spawn workers that
  find nothing to do. Numbers in [`plans/perf-lint-ci-local-split.md`](plans/perf-lint-ci-local-split.md).
- `yarn typecheck` — `vue-tsc -b`, and it covers the whole repo: the root `tsconfig.json`
  references all five projects (app, node, server, and the two spec ones — including the specs
  colocated under `server/` rather than in `test/`). Adding a project means adding it there too,
  or nothing type-checks it and CI will not tell you.
- `yarn build` — `vue-tsc -b && vite build`.
- `yarn test` — **Vitest** (`test/**/*.spec.ts`). Mock external APIs; tests must run without API keys.
- `yarn dev` — server + Vite together (local development).

### Import a component at module scope, never inside a test

`await import("…/Foo.vue")` inside an `it` (or a helper an `it` awaits) pulls the component's
whole module graph through the transform, and **the first test to reach it is billed that time
against `testTimeout`**. On this repo that was 2132ms of loading against an 18ms mount — so the
file's first test looked 100x slower than its siblings, and on a loaded runner it was the one
that crossed 15s and went red (#1314). The test was never the slow part.

Load it once at module scope instead — `const Foo = (await import("…/Foo.vue")).default;`, a
top-level await, or a plain static import. Collection has no per-test budget, so the same work
costs nothing there.

The exception is a module that must be evaluated AFTER a non-hoisted mock: `vi.doMock` and
`vi.resetModules` only take effect on a later import, so those specs (`codeBlockCopy.spec.ts`,
several under `test/server/`) keep the import inside the test on purpose. `vi.mock` is hoisted
and needs no such thing.

## No emojis
**Never use emojis anywhere in this project** — UI, source comments, docs, changelog, commit
messages, skills, CLI output. Icons are **Material Symbols (outlined)**, self-hosted via the
`material-symbols` npm package: `<span class="material-symbols-outlined">icon_name</span>`.
A global rule in `src/style.css` gives them `font-size: inherit`, so size them on the parent.

- A header button in config (`server/config/header-config.ts`) takes **`icon`**, not `emoji`.
  The `emoji` field still exists for end-user configs and wins over `icon` when both are set —
  don't use it in anything this repo ships.
- Three deliberate exceptions, all functional. Don't "fix" them:
  - `server/session/screen-rows.ts` — `/^\s*[❯›]\s/u` parses Claude Code's real terminal output.
  - `src/composables/useDynamicFavicon.ts` — the `❯` chevron drawn on canvas as the favicon mark.
  - `bin/mulmoterminal.js` — the CLI doctor's `✓ / ✗ / ○` (a terminal can't render an icon font).
- Compact status **notation** stays text, not icons: `⎇ main ●3 ↑2`, `●` unsaved dots, `−12` diff
  counts. Icons there are bigger and slower to scan.

## Layout
- `server/` — backend (PTY sessions, config, agents, backends). Ships user-facing skills in `server/skills/`.
- `src/` — Vue web UI (App.vue, components, composables, router).
- `common/` — code shared by server and UI. **Both** `tsconfig.server.json` and
  `tsconfig.app.json` include it, so a value or wire type that BOTH sides decide from
  (a shared config, an `/api/*` response shape, an enum) belongs here — never mirrored
  into `server/` and `src/` with a "keep the two copies in sync" comment. When the two
  sides genuinely differ, share the common core and keep each side's extras local, with
  a test pinning the asymmetry (see `common/sourceExtensions.ts` + its spec).
- `bin/` — CLI entry (`npx mulmoterminal`, `claude-ollama`, …).
- `docs/` — Jekyll site; bilingual guide under `docs/guide/{en,ja}` (keep both in sync).
- `plans/` — design notes per change. `test/` — Vitest specs.

## The grid has three view modes — read before changing anything a cell renders

`TerminalGrid.vue` is ONE `.stage` in three CSS states: the **tiled grid** (`!zoomed`), the
**cockpit roster** (`zoomed && listMode`, the default when you enlarge) and the **filmstrip**
(`zoomed && !listMode`). There is one component instance per cell and it is never remounted — the
enlarged one is **teleported** out, and in roster mode the rest are parked off-screen but **still
live**. The roster row is not a `TerminalCell` at all; it is a separate template with its own
chrome. And the tiled grid shows one page of ≤9 while both zoomed modes show **every** cell.

So "collapse the cell to its header" is already shipped in one mode, needs a new layout mechanism
in another, and lands on a different component in the third. Work it out from
[`docs/grid-view-modes.md`](docs/grid-view-modes.md) rather than from the screen you happen to be
looking at.

## MulmoClaude is the reference host — read it before wiring a shared package

**MulmoClaude's source is a sibling checkout at `../mulmoclaude`.** It drives the same
`@mulmoclaude/*` packages over the **same workspace on disk** (`~/mulmoclaude`), so for
anything those packages define, it is not "another app" — it is the existing answer.

Before writing or changing a host binding for a shared package (`@mulmoclaude/core`, the
collection / accounting / google / html / markdown plugins), **find its counterpart there
first** — `grep` the feature name under `../mulmoclaude/{server,src}`. Match it on:

- **`/api/*` route paths** — MulmoClaude keeps them in `src/config/apiRoutes.ts`; that file
  is the naming authority, not a guess from the plugin's JSDoc.
- **Which failures are HTTP status vs. a field on a 200.** Plugins route `!ok` and a
  successful body to different places in the UI, so this is behaviour, not style.
- **User-facing wording** for the same condition. Someone running both hosts must not get
  two different explanations for one setup problem.
- **Wire shapes**, including fields neither side reads yet.

Why this needs saying: we own **both** ends here — the Express route and the Vue binding
that calls it — so a divergent path or status is self-consistent and **works**. `typecheck`,
the specs, CI and the review bots all pass. Only a human comparing the two repos sees it.
In #907 the push route shipped as `/calendar/push` against MulmoClaude's `/calendar-push`,
green the whole way, and was caught only because someone pointed at `../mulmoclaude`.

`server/backends/collections.ts` already requires this of the **on-disk** layout (so both
apps discover the same collection skills). The API surface needs it for the same reason and
had no rule until now.

Deliberate divergence is fine — say so in a comment with the reason, and flag it in the PR.

## A shared app is enforced by Firestore rules, not by this repo

`server/backends/sharedApp/` looks like the authority over a shared app and is not. Its checks run
on the author's machine only; what binds a stranger writing to Firestore directly is
`../mulmoserver/firestore.rules`, deployed by hand with no CI. So a guarantee added here alone is a
diagnostic — and a condition added to a rule is paid for by every request that evaluates it, which
on a shared path (`items` create/update) means every app using that path. The budget is 1000
expressions per request, so measure the paths a change lands on rather than the change.

Read [`docs/shared-app-principles.md`](docs/shared-app-principles.md) before adding a key, a view,
or an operation — it is the short list of invariants and where each one is actually held. The
decisions behind them are D1–D10 in `plans/feat-shareable-collections.md`; what is planned next is
[`plans/feat-shared-app-platform.md`](plans/feat-shared-app-platform.md).

## The GUI MCP has three server-id shapes, and they are not meant to match

The same tool is called `mcp__mt__presentChart` in a workspace cell,
`mcp__mulmoterminal-render__presentChart` in a project cell, and
`mcp__plugin_mulmoterminal_render__presentChart` in a muse cell. All three are current. The branch is
`carriesFullGuiMcp()` in `server/session/mcp-config.ts`: the workspace / single view / cell-less chat
gets a **generated** `--mcp-config` carrying every tool under `GUI_SERVER_ID`; a project cell is
handed **no `--mcp-config` at all** and reaches the tools through the user's own `.mcp.json` under the
per-group ids from `toolGroupServerId()`. Both constants live in `common/toolGroups.ts`.

**Ask that predicate from every new spawn path that starts an AGENT.** It is deliberately
agent-agnostic: claude cells and codex cells both consult it, so two terminals in the workspace reach
the same tools however they were started. It sat in `spawn-claude.ts` while claude was the only
caller, and the drift that produced — a codex cell silently getting less than the cell beside it —
is exactly what a new path re-creates by not asking.

**A launcher chip is not one of those paths, and must never become one.** A chip runs the user's
command line **verbatim, and nothing in this repo parses it**. There is no launcher command parser —
if you are looking for one, it was deleted, not moved. Concretely: no flags are inserted, no MCP is
attached, `handleLaunchConnection` passes `worktreeLimited: false` unconditionally, and
`spawnLauncherPty` records `agent: "shell"` whatever the command names.

It was not always so — a chip whose command was `claude` or `codex` was rewritten for parity with
the cell (#1040, #1358), and a command starting with the word `codex` was held to the worktree limit
(#1207, #1208). All of it was removed deliberately: a chip that silently runs something other than
what it says is what made the chips and the Agent Picker impossible to tell apart, and every one of
those behaviours rested on guessing at text the user wrote.

**A CUSTOM AGENT is the other side of that line, and it works because it is DECLARED.** A
`customAgents` entry in the global config (`common/customAgents.ts`) is an Agent Picker option whose
`command` the user writes — `ollama launch claude --model … --` — and Claude Code's whole argv is
appended to it, so the session resumes, reports cost, and gets the GUI tools. The reason that is not
the banned guessing above: the entry carries `agent: "claude"`, saying which CLI's arguments to
append. It is required, and an entry omitting it is dropped on load. Nothing reads the command text
to decide anything. Adding a second value to `CUSTOM_AGENT_KINDS` means teaching the spawn to build
THAT agent's argv — it is not a label.

So do not re-add a recogniser, however narrow, and do not "restore" the worktree limit for chips —
that hole is known and accepted (a `codex` chip can occupy a worktree twice). A chip that wants GUI
tools asks for them in the flags the user writes. Agent behaviour belongs to the Agent Picker.

**Muse is the third shape and the one that breaks the pattern.** It reads neither a flag nor a file
in the directory: MCP servers are declared by an installed PLUGIN (`server/agents/muse-mcp.ts`), and
`muse plugins install` records one PER MACHINE — `--scope project` writes nothing into the project.
So the registration cannot express "this directory gets render", and two things follow that nothing
else here does:

- a plugin MCP server is started with a **curated environment** — measured at 16 variables, all of
  muse's own — so `guiMcpEnv` does not reach it and neither does an `env` block in the manifest.
  The group and the port are argv; the SESSION is asked for, by walking the bridge's process tree
  back to a tmux pane whose name is the session id (`server/session/bridge-session.ts`).
- the four servers are registered for every session, and the ones a session is not entitled to
  serve an EMPTY toolset rather than failing. Erroring would show three broken servers in a cell
  that switched one group on.

Do not "fix" that by trying to install per directory, and do not add an env var for the bridge —
both were tried, and both fail silently by serving zero tools.

The ids differ in **who owns them**, which is what decides whether a rename is free:

- `GUI_SERVER_ID` (`mt`) — regenerated on every spawn, written to no file a user keeps. Ours. It is
  short because the client repeats it on **every tool name** (`mcp__<id>__`, or codex's
  `mcp-<id>-` with `-` rewritten to `_`), so the id is paid per tool, per listing, per session.
- muse's per-group ids (`render`, `data`, …) — **ours, inside a manifest we generate**, and short
  for `GUI_SERVER_ID`'s reason: muse builds the tool name out of the plugin id AND the capability
  id, so `mulmoterminal-render` inside a `mulmoterminal` plugin would say our name twice in every
  tool name. Free to rename, and a rename re-registers itself on the next spawn.
- `toolGroupServerId()` (`mulmoterminal-render`, …) — **keys in config files users wrote**, read
  back by the launcher's per-group switch, documented in the setup guide. Renaming these breaks
  working setups with no error anywhere; it needs a migration over existing per-folder configs.

So: do not "fix" the inconsistency by unifying them, and do not shorten a group id. If a rename is
genuinely wanted, it is a migration, not an edit. When you add an id for a NEW single-view-style
server, add the old one to `LEGACY_GUI_SERVER_IDS` — the reserved-id list and the Antigravity config
merge recognise our own past output by it, and dropping it strands an entry on someone's disk.

## Bundled skills
`server/skills/` ships skills to end users; they are mirrored to `~/.claude/skills/` and the Codex
skills root. **`BUNDLED_SKILL_NAMES` in `common/bundledSkills.ts` is what ships them** — adding a
directory is not enough, and a directory nobody lists is copied nowhere with no error anywhere (a
spec pins the two together). It is in `common/` because the UI names skills too: each Settings
section a skill can write ends in a `SkillLaunchButton`, whose `skill` prop is a `BundledSkillName`,
so a slug naming nothing that ships is a type error rather than an agent that can't find it.

`mulmoterminal-config` is the **entry point**: it routes to the skill that owns an area, and it
reports on how things are configured now. The writing skills are `mulmoterminal-dirs` (per-project
colours, grid/launcher order, name, font size), `-theme` (custom global colour schemes), `-header`
(buttons/chips), `-keys` (keymap, copy-on-select, Enter), `-model` (providers), `-notify` (sounds,
push). Plus `mulmoterminal-bug-report` and `mulmoterminal-decisions`.

**A setting belongs to exactly one skill.** When you add or change a config key, update that
skill — not the router, which must stay a table of contents. #1097 is the cautionary tale: it
changed what `orderPriority` does, README and both guides were updated, and the one 558-line
monolith that also documented it was missed.

**A skill with a Settings section is launched from it, not just named in prose.** `-header` and
`-model` have no section and so have no button. Give a new writing skill one, and say in the
section's own copy what the skill does that the controls above it can't — a button that looks like
a slower way to do what the UI already does is not pressed.

## Publishing a release

`/publish` drives the mechanics (bump, tag, npm, GitHub release). Three things are this repo's own.
The first two are easy to skip because the release still "works" without them; the third is the one
a spec will stop you on:

**1. `docs/ChangeLog.md`** — English, newest-first, the same per-PR detail as the GitHub release.
It records **what changed and why**.

**2. A dated setup guide, `docs/guide/{en,ja}/v<version>.md`** — for the person who wants a new
feature **the day it ships**. The changelog explains what changed; it does not tell anyone how to
turn a thing on, and for something like `keymap` there is otherwise nowhere to look. Write the
procedure: open this file, paste this, restart what, how to tell it worked, what breaks on a Mac.

- **Both languages**, and `nav_order` must be a **unique** sequence running **newest release
  first** — ordered by release date, not by version number sorted as text, so 1.11.1 sits above
  1.11.0. **`nav_order` DESCENDS as the version rises**: the oldest release page is `10000000`,
  and a new release takes **one less than the current smallest**. So shipping a release is
  **one new file per language and nothing else moves** — no renumbering.
  Find the number by enumerating, never by memory: `grep -h nav_order docs/guide/en/v*.md | sort -n | head -1`.
  The old scheme counted UP from 1001 with the newest at the top, which meant every release
  renumbered all fifty pages in both languages.
  **The starting point is huge on purpose.** The reference guide keeps the small numbers (1–17),
  and counting down from anything near them would eventually reach them — which is not
  hypothetical: the guide had reached `claude-ollama` = 14 and `glossary` = 15 while releases
  started at 14, and just-the-docs breaks a tie by title, so the sidebar quietly read
  4.5.0 / glossary / 4.4.0 with nothing erroring. At `10000000` the two ranges cannot meet.
  When renumbering anyway, **enumerate `docs/guide/*/v*.md` rather than typing the list out**:
  a hand-typed list has silently dropped a page, and the check written from the same list agreed
  with it, so nothing caught the duplicate until review did.
- **State the date in the first line and call it a snapshot.** These pages *will* go stale — that
  is accepted, and the date is what makes a stale one readable rather than misleading. Never
  edit an old one to match new behaviour; write the next version's page instead.
- **Link out to the living guide from every section.** The dated page holds the procedure, the
  guide holds the reference — do not duplicate the reference.
- A fix-only release still gets a page: "nothing to configure", what was broken, and **how to
  tell you have the fix**. That is what an upgrader actually wants to know.
- **Link it from the changelog entry** (a `> **Setup guide:**` blockquote line right under the
  heading — the old convention used a book emoji, dropped per **No emojis** above). Before this
  existed the changelog had one link into the guide in 717 lines, which is why nobody found the
  manual.
- **Point the guide index at the new page.** `docs/guide/{en,ja}/index.md` opens with a
  `> 🆕` banner naming the newest release. Adding a version page does not update it, and nothing
  fails when it goes stale — it sat on 2.0.0 through four releases, so the front door advertised
  a version nobody was running.
- **Verify before committing**: every internal link resolves to a real page *and anchor*, and any
  config sample is run through its real validator — a bad `keymap` sample stops a reader's server
  from starting.
- **Anything the user SEES gets a screenshot.** A colour, a new panel, a pane opening somewhere —
  prose describing where a stripe appears is worse than the stripe. Existing images live in
  `docs/guide/images/`, referenced `../images/foo.png`; name a release's own `v<version>-<thing>.png`.
  Capture with Playwright against a real running server (`deviceScaleFactor: 2`, then downscale —
  the repo's images run 60KB–840KB). Three traps, each of which cost a retake:
  - **Screenshots leak the maintainer's directories.** Settings' Directory-settings list, the
    launcher chips and the cockpit roster all show real paths. Run the capture with `HOME` pointed
    at a scratch dir holding its own `.mulmoterminal/config.json` (`cwdPresets`, `launchers`), so
    **the live config is never touched** and only chosen directories appear. Ask which paths may
    be shown before publishing any.
  - **A short shell prompt has to be arranged.** The demo `HOME` needs its own `.zshrc`
    (`PROMPT='%1~ $ '`), and tmux will re-attach an OLD shell that predates it — use a directory
    that has no session yet, or the prompt in the shot is not the one configured.
  - **Never guess where a terminal link is.** Hover across the row and take the x range where the
    computed `cursor` becomes `pointer`; a coordinate estimated from the image is off by enough to
    click nothing (and a click that silently misses looks exactly like a broken feature).

**3. `docs/facts.json`** — the machine-readable copy of what this package is, read by tools rather
than people, so a stale field is a wrong answer nobody can see is wrong. Unlike 1 and 2 this one is
**enforced**: a spec pins its `version` and `requires.node` to `package.json`, so the bump belongs
in the same commit and `yarn test` goes red until it is there. Leave `updated` alone — it means
"when a human last read this file against reality", not "when it was last touched". Nothing checked
any of it until #1988, and the version had sat on 4.4.0 for twelve releases.

## Filing issues
- Before filing a **bug / "broken" / "weird behaviour"** issue about MulmoTerminal, run the
  **`mulmoterminal-bug-report`** skill first: it checks whether the behaviour is actually
  config or by-design (reading the real config/schema/version), searches existing issues, and
  only files what survives — with env/repro masked.
- This gate is for bug reports. Pure feature requests / enhancements don't need it.
