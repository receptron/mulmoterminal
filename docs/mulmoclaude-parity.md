# MulmoClaude parity — what's shared, what's deferred, and why

MulmoTerminal consumes MulmoClaude's headless backend through the shared
`@mulmoclaude/core` package (subpath exports) instead of reimplementing it, so
the two hosts can't drift. This doc records where that effort stands: which
subsystems are shared today, which are deliberately **not**, and what picking
up each remaining item would involve.

Status date: **2026-07-18** (core `0.23.0`, collection-plugin `0.11.1`).

---

## Shared today

Each of these runs the same engine as MulmoClaude, with host specifics injected:

| Subsystem | Core entry | MulmoTerminal wiring |
| --- | --- | --- |
| Collection engine (discovery, CRUD, actions, views, registry) | `@mulmoclaude/core/collection(/server)` | `server/backends/collections.ts` |
| `manageCollection` MCP tool (agent data plane: getItems with computed fields, validated putItems, getOntology, schemaDocs, getSchema/putSchema) | `@mulmoclaude/core/collection/server` | `server/infra/collection-tool.ts` + host-tool dispatch in `server/index.ts` (#384) |
| Workspace setup (help docs + preset-skill seeding) | `@mulmoclaude/core/workspace-setup` | `server/backends/workspaceSetup.ts` (#122) |
| File-change publisher | `@mulmoclaude/core/file-change` | `server/backends/fileChange.ts` (#123) |
| Notifier + collection completion watchers (bell UI) | `@mulmoclaude/core/notifier`, `/collection-watchers` | `server/backends/notifier.ts`, `collectionWatchers.ts` (#124) |
| Scheduler engine + user cron tasks (`config/scheduler/tasks.json` → spawn a visible chat) | `@mulmoclaude/core/scheduler` | `server/backends/scheduler.ts` (#125) |
| RSS/JSON feed refresh (system task) | `@mulmoclaude/core/feeds(/server)` | `server/backends/feeds.ts` + `feedRefreshTaskDef` registration in `server/index.ts` |
| Google account (loopback OAuth) + Calendar (events, non-primary calendars, colours) incl. the settings-UI link routes | `@mulmoclaude/core/google` | `server/backends/google.ts` (shim + `/api/google/*`), `remoteHost/googleCalendar.ts` (`createEvent`/`listEvents` w/ `calendarId`+`colorId`, `listCalendars`, `colors`), `server/cli-google.ts` (#386, #425) |

The two workspaces are interchangeable: both apps read and write the same
on-disk layout (`data/`, `.claude/skills/`, `config/`), and cross-app invariants
(e.g. the notification adapter shape both apps dedupe on) are pinned by tests.

The Google link is shared *outside* the workspace too: core owns the token
(`~/.config/mulmo/google-token.json`) and the OAuth client secret
(`~/.secrets/client_secret_*.json`), both host-neutral since core `0.20.1`, so
linking once on a machine serves both apps.

---

## Remaining differences

These were the tail of the shared-services plan (originally labeled PR4c, PR4d,
PR5), plus one behavioral gap found during the collection-plugin 0.11 upgrade.
Each is deferred for a reason, not forgotten.

### 1. Journal + chat-index system tasks (was PR4c)

**What MulmoClaude has:** two scheduler system tasks — a periodic *journal*
that summarizes chat activity into a daily document, and a *chat-index
backfill* that indexes past sessions for search.

**Why MulmoTerminal doesn't:** both are welded to MulmoClaude's chat-session
model (SDK transcripts, its session store, its message shapes). MulmoTerminal
sessions are PTYs running the real Claude CLI — the equivalent source material
is terminal scrollback plus Claude Code's own transcript files, which is a
different data model, not just a different path. `server/backends/scheduler.ts`
documents the decision: journal / chat-index stay MulmoClaude-only.

**Picking it up means:** first a design decision — what does a journal or a
searchable index over PTY sessions mean, and which source of truth feeds it
(Claude Code transcripts under `~/.claude/projects/…` are the likely answer)?
Only then an engine extraction. Lowest standalone value of the three; leave it
until there's a concrete need.

### 2. Scheduler task CRUD + tasks UI (was PR4d)

**What MulmoClaude has:** routes and a panel to create / edit / delete
scheduled tasks.

**What MulmoTerminal has:** the engine only. Tasks in
`config/scheduler/tasks.json` load at boot and fire correctly, but the sole
route is a read-only `GET /api/scheduler/tasks` — creating or changing a task
means editing the JSON by hand (or asking the agent to edit it, which works
fine and is the current de-facto CRUD).

**Picking it up means:** write routes over the same validated
`buildUserTaskDefinitions` path, plus a small tasks view. Pure convenience on
infrastructure that already works; user-visible but low risk.

### 3. Skill-bridge (staging → active mirror) (was PR5)

**What MulmoClaude has:** skills are authored under `data/skills/<slug>/`
(staging, the canonical copy) and mirrored into `.claude/skills/` (what Claude
discovers). A PostToolUse hook fires on every agent file write and mirrors
changed skill files automatically (`@mulmoclaude/core/skill-bridge`).

**What MulmoTerminal has:** a partial, indirect version. `manageCollection`'s
`putSchema` mirrors schema writes itself (the core engine calls
`mirrorSkillWrite` internally), so schema edits made through the tool land in
both trees. But there is no general hook: a raw `Write` to any other staged
skill file (SKILL.md, templates, custom views) silently never reaches
`.claude/skills/`.

**Why it matters more now:** collections *are* skills, and agents actively edit
them in MulmoTerminal. The failure mode is a quiet inconsistency — an edit that
looks saved but isn't discovered — which is confusing to debug. This is the one
remaining item with correctness stakes.

**Picking it up means:** a PostToolUse hook handler in MulmoTerminal's server
(the hook-event plumbing already exists for session status tracking in
`server/index.ts`) that applies the shared mirror rule, plus committing to the
`data/skills/` authoring convention in this app.

### 4. `kind: "agent"` collection actions run visible, not hidden

Not part of the PR4/PR5 series, but a real behavioral difference documented
during the collection-plugin `0.11` upgrade (#383).

**What MulmoClaude does:** an action declared `kind: "agent"` is dispatched
server-side as a *hidden* worker; the route answers `{dispatched: true}` and
the record panel shows a spinner until the completion ping.

**What MulmoTerminal does:** the same action returns the seed prompt and opens
a *visible* chat session — a documented fallback the plugin supports. The work
still happens; it just occupies a visible session and the button's running
state relies on the eventual record refetch rather than a dispatch
acknowledgement.

**Picking it up means:** dispatching via the existing hidden-session machinery
(`spawnBackgroundChat` internals) from the item/collection action routes in
`server/backends/collections.ts`, answering `{dispatched: true}`, and adding
the run-key bookkeeping the plugin reads from the detail response.

---

## Suggested order, if resuming

1. **Skill-bridge (PR5)** — correctness stakes, and the mirror rule + hook
   plumbing both already exist; it's wiring, not design.
2. **Agent-kind dispatch parity** — small, contained in the collections
   backend, improves the plugin UX.
3. **Task CRUD + UI (PR4d)** — convenience; do when the tasks feature gets real
   use.
4. **Journal / chat-index (PR4c)** — needs a design conversation first; wait
   for a concrete need.
