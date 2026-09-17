# MulmoClaude parity — what's shared, what's deferred, and why

MulmoTerminal consumes MulmoClaude's headless backend through the shared
`@mulmoclaude/core` package (subpath exports) instead of reimplementing it, so
the two hosts can't drift. This doc records where that effort stands: which
subsystems are shared today, which are deliberately **not**, and what picking
up each remaining item would involve.

Status date: **2026-08-05** (core `2.1.0`, collection-plugin `2.0.0`).

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
| Collection ↔ Google Calendar: hourly pull, manual sync (the header button's calendar arm), push | `@mulmoclaude/core/google` | `server/backends/system-tasks.ts` (`googleCalendarSyncTaskDef`), `calendarRefresh.ts` + `calendarRefreshResult.ts`, `calendarPush.ts` + `calendarPushResult.ts` |

The two workspaces are interchangeable: both apps read and write the same
on-disk layout (`data/`, `.claude/skills/`, `config/`), and cross-app invariants
(e.g. the notification adapter shape both apps dedupe on) are pinned by tests.

The Google link is shared *outside* the workspace too: core owns the token
(`~/.config/mulmo/google-token.json`) and the OAuth client secret
(`~/.secrets/client_secret_*.json`), both host-neutral since core `0.20.1`, so
linking once on a machine serves both apps.

---

## Collection API paths — three deliberate divergences

The collection REST surface is the same on both hosts **except for three paths**.
Everything else matches character-for-character: `items`, `item`,
`itemAction`, `collectionAction`, `refresh`, `calendar-push`, `view-file`,
`remote-view` (+ `/mutate`, `/items`), `view-token`, `view-data` (+ `/query`,
`/actions/:actionId`, `/image`), `view-i18n`, `views/:viewId`. So this is three
named exceptions, not a drifting surface — and they are listed here so the next
host binding or external script uses **the spelling of the host it talks to**
(MulmoTerminal's column against this server, MulmoClaude's against that one)
instead of inventing a third (CLAUDE.md's parity rule; #907 is the cautionary
tale).

| Concern | MulmoClaude | MulmoTerminal |
| --- | --- | --- |
| List | `GET /api/collections` | `GET /api/collections/list` |
| Detail | `GET /api/collections/:slug` | `GET /api/collections/:slug/detail` |
| Registry | `/api/collections-registry/*` | `/api/collections/registry/*` |

**Why.** All three come from one instinct: keep a literal segment from ever
being read as a `:slug`. MulmoClaude leans on path *shape* — list and detail are
both `GET`, told apart only by whether a segment follows `/api/collections`, and
the registry sits outside the namespace entirely under its own top-level
`collections-registry` prefix. MulmoTerminal instead put every literal *inside*
`/api/collections`, which forces the suffixes: `/api/collections/registry/list`
only stays unambiguous because it is mounted **before** the `:slug` routes
(`server/backends/collections.ts` says so at the mount site), and `list` /
`detail` sidestep the shape question rather than relying on it. The response
*shapes* are MulmoClaude's; only the URLs differ.

**Consumer of record: `src/composables/collectionUi.ts`.** The plugin's UI
binding is what actually calls these, and it is self-consistent with the server —
`test/server/backends/collections.spec.ts` pins MulmoTerminal's own spelling
(`GET /api/collections/list`, `/:slug/detail`), as it should. So no test here can
catch the divergence; only a comparison against MulmoClaude shows it, which is
what this table is for. Treat that binding plus the mount block in
`server/backends/collections.ts` as the pair that has to agree.

**Not fixed here, on purpose.** Renaming the runtime paths, or adding aliases at
MulmoClaude's spellings, are both live options and both out of scope for the
documentation (#1492). Nothing outside this app depends on the MulmoTerminal
spellings today — remote-host commands do not go through these URLs — so the
cost of aliasing later is low; the cost of a *third* spelling is not.

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

**What MulmoTerminal has:** the engine, plus the same persistence adapter since
issue #1581 — system tasks catch up at startup for windows missed while the server
was off, every run is recorded, and the read-only routes (`GET /api/scheduler/tasks`
with each task's state, `GET /api/scheduler/logs`) mirror MulmoClaude's shapes.
What is missing is the write half: creating or changing a task means editing
`config/scheduler/tasks.json` by hand (or asking the agent to edit it, which
works fine and is the current de-facto CRUD), and there is no tasks view.

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

### 4. Custom-view host surface — shipped, with two known edges

The endpoints a sandboxed custom view talks to, and the authorization rules
guarding them, are now the same on both hosts (#1490) — the response *bodies*
still differ in the one place noted at the end of this section. This is
deliberately parity-tracked rather than "MT's own API", because core's bundled
authoring docs — which MulmoTerminal itself serves
through `manageCollection`'s `schemaDocs` — tell collection authors these exist:

| Endpoint | Where |
| --- | --- |
| `GET …/view-i18n` (parent-side; feeds `__MC_VIEW.dict` / `t()`) | `server/backends/customViewRoutes.ts` |
| `GET …/view-data/image` | same file (+ `isAuthorizedImagePath`) |
| `POST …/view-data/actions/:actionId` | same file — mutate kind only |
| `POST …/view-data/query`, `GET`/`PUT …/view-data` | `server/backends/collections.ts` (#167) |

Rules worth keeping when touching these: the image route's authorization *is*
the record scan (only a **current** value of an `image` field resolves, never an
arbitrary workspace path), and the action route is **mutate-only** — a view
token must never be able to start LLM work, so `chat` / `agent` actions stay on
the parent-side route. Both sit behind per-minute budgets
(`server/backends/viewRateLimit.ts`), images in a roomier bucket than actions
because a gallery's first paint is legitimately dozens of fetches.

Two differences remain, both benign but real:

- **`GET …/view-data` ignores `ids` / `fields`.** MulmoClaude routes that read
  through `manageCollection`'s `getItems`; MulmoTerminal returns every enriched
  record. A view that passes `?fields=…` (as the core doc's examples do) gets a
  superset, so it renders correctly — it just transfers more than it asked for.
- **The registry is list + import only** — no preview or export route.

### 5. `kind: "agent"` collection actions run visible, not hidden

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

### 6. First sync of a freshly declared `googleCalendar` collection

**What MulmoClaude has:** `startInitialCalendarSync`
(`server/services/google/initialCalendarSync.ts`), fired from the config refresh
that both a Write-tool create and `manageCollection`'s `putSchema` converge on.
It calls `syncNewCalendarCollections`, so a calendar a user has just declared
fills immediately.

**Why MulmoTerminal doesn't:** nothing decided it; the manual arm of the same
feature was the gap that issue #2108 reported, and this is its other half.
Nothing is lost without it — `syncDueCalendarCollections` treats a never-synced
collection as due, so the hourly task picks it up — which makes this latency, not
a missed sync, and a separate change from the one that made the button work.

**Picking it up means:** finding this host's equivalent of that convergence
point (there is no `/api/config/refresh` here) and calling
`syncNewCalendarCollections` behind the same single-flight, since authoring a
collection writes several files in a burst.

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
