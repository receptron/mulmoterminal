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
- `yarn lint` — ESLint.
- `yarn typecheck` — `vue-tsc -b`. **App code only — it does NOT compile the specs.**
- `yarn typecheck:server` / `yarn typecheck:test` — CI runs these too. `typecheck:test`
  (`tsconfig.test.json` + `tsconfig.test-server.json`) is the one that type-checks the specs,
  including the ones colocated under `server/` rather than in `test/`. Change a shared type or
  a wire shape and run **all three**: `yarn typecheck` alone passes while CI fails.
- `yarn build` — `vue-tsc -b && vite build`.
- `yarn test` — **Vitest** (`test/**/*.spec.ts`). Mock external APIs; tests must run without API keys.
- `yarn dev` — server + Vite together (local development).

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

## Bundled skills
`server/skills/` ships skills to end users; they are mirrored to `~/.claude/skills/` and the Codex
skills root. **`BUNDLED_SKILL_NAMES` in `common/bundledSkills.ts` is what ships them** — adding a
directory is not enough, and a directory nobody lists is copied nowhere with no error anywhere (a
spec pins the two together). It is in `common/` because the UI names skills too: each Settings
section a skill can write ends in a `SkillLaunchButton`, whose `skill` prop is a `BundledSkillName`,
so a slug naming nothing that ships is a type error rather than an agent that can't find it.

Core's `skill-bridge` — a workspace's `data/skills/` staged into the `.claude/skills/` the CLI
discovers — is a separate mechanism we never import. MulmoClaude provisions it into
`<workspace>/.claude/settings.json`, and Claude Code MERGES those hooks with our `--settings`, so
it already fires for our sessions in any workspace MulmoClaude has started against. Don't
reimplement it here; check that workspace first (#1191).

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

`/publish` drives the mechanics (bump, tag, npm, GitHub release). Two things are this repo's
own, and both are easy to skip because the release still "works" without them:

**1. `docs/ChangeLog.md`** — English, newest-first, the same per-PR detail as the GitHub release.
It records **what changed and why**.

**2. A dated setup guide, `docs/guide/{en,ja}/v<version>.md`** — for the person who wants a new
feature **the day it ships**. The changelog explains what changed; it does not tell anyone how to
turn a thing on, and for something like `keymap` there is otherwise nowhere to look. Write the
procedure: open this file, paste this, restart what, how to tell it worked, what breaks on a Mac.

- **Both languages**, and `nav_order` must be a **unique** sequence running **newest release
  first** — ordered by release date, not by version number sorted as text, so 1.11.1 sits above
  1.11.0. A new release takes the lowest free number and everything below shifts down by one.
  When renumbering, **enumerate `docs/guide/*/v*.md` rather than typing the list out**: a
  hand-typed list has silently dropped a page, and the check written from the same list agreed
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

## Filing issues
- Before filing a **bug / "broken" / "weird behaviour"** issue about MulmoTerminal, run the
  **`mulmoterminal-bug-report`** skill first: it checks whether the behaviour is actually
  config or by-design (reading the real config/schema/version), searches existing issues, and
  only files what survives — with env/repro masked.
- This gate is for bug reports. Pure feature requests / enhancements don't need it.
