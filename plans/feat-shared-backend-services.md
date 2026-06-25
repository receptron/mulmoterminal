# feat: wire MulmoClaude's shared backend services into MulmoTerminal

## Goal

MulmoClaude extracted its **headless backend behavior** into reusable packages, then
**consolidated them into a single package `@mulmoclaude/core`** (MulmoClaude PRs
#1793 / #1794 / #1795, published to npm as `@mulmoclaude/core@0.2.0`). Each former
`packages/services/*` package is now a **subpath export** of `@mulmoclaude/core`
(e.g. `@mulmoclaude/core/notifier`); the collection engine also moved out of
`@mulmoclaude/collection-plugin` into `@mulmoclaude/core/collection`(+`/server`), leaving
`@mulmoclaude/collection-plugin` as **Vue-only** (`./vue`). This plan wires those
subsystems into MulmoTerminal so a **MulmoTerminal-alone run** (the user never boots
MulmoClaude) still gets the full workspace experience — seeded helps/presets, live-refresh
on writes, notifications, completion bells — instead of an empty, inert workspace.

> **Migration note (2026-06-25):** this plan originally targeted six separate
> `@mulmoclaude/{workspace-setup,file-change-publisher,notifier,collection-watchers,scheduler,skill-bridge}`
> packages. They no longer exist as standalone packages — add **one** dependency
> `@mulmoclaude/core@^0.2.0` and import each subsystem from its subpath (table below).
> The APIs are unchanged; only the import specifiers changed.

Both apps share one workspace (`CLAUDE_CWD`, default `~/mulmoclaude`) and never run
simultaneously, so the services are safe to share with **no locking**. Each service is
consumed through a **thin host binding** under `server/backends/*` that injects
MulmoTerminal's specifics (pubsub, workspace root, logger, routes, navigation).

This is a **restart**: a first pass shipped as PRs #63/#64/#65 (now closed) and gathered
review feedback. That feedback is folded into this plan up-front so the redo lands clean.

## The shared subsystems — all subpaths of `@mulmoclaude/core@^0.2.0`

One dependency: `@mulmoclaude/core@^0.2.0`. Import each subsystem from its subpath:

| Import (subpath of `@mulmoclaude/core`) | Role | Key API |
|---|---|---|
| `@mulmoclaude/core/workspace-setup` | seed helps + preset skills at boot | `seedHelps({destDir})`, `syncPresetSkills({sourceDir,destDir,onInfo,onWarn})`, `syncActivePresetSkills({sourceDir,activeDir,...})`, `presetSkillsAssetDir()`, `helpsAssetDir()`, `isPresetSlug()` |
| `@mulmoclaude/core/file-change` | broadcast "workspace file changed" to pubsub | `configureFileChangePublisher({publish,workspaceRoot,toPosix,primaryChannel?,pluginScopes?,onPublished?,warn?})`, `publishFileChange(rel)`, `pluginFileChannel(scope,posix)` |
| `@mulmoclaude/core/notifier` | active+history notification engine | `configureNotifier({writeJson,publishEvent,log?})`, `setNotifierFilePaths({active,history})`, `publish`/`clear`/`cancel`/`listAll`/`listHistory`/`listFor`/`updateForPlugin`/`onEvent`, `NotifierEvent` |
| `@mulmoclaude/core/collection-watchers` | fs.watch per collection → completion bells via the notifier | `configureCollectionWatchers({adapter,log})`, `startCollectionWatchers(opts)`, `CollectionNotificationAdapter`, `CompletionPriority` |
| `@mulmoclaude/core/scheduler` | cron tick engine + persistence adapter | `createTaskManager({log})`, `configureScheduler({workspaceRoot,writeFileAtomic,log})`, `initScheduler(taskManager,systemTasks)` |
| `@mulmoclaude/core/skill-bridge` | mirror `data/skills/<slug>/` → `.claude/skills/` (PostToolUse rule) | `bridgeTargetFromDataPath`, `slugFromRmCommand`, `mirrorSkillWrite`, `mirrorSkillDelete` |
| `@mulmoclaude/core/collection` + `@mulmoclaude/core/collection/server` | isomorphic + node collection engine (moved out of `@mulmoclaude/collection-plugin`) | `discoverCollections`, `loadCollection`, `configureCollectionHost`, `whenMatches`, types; `@mulmoclaude/core/collection/paths` → `isSafeActionTemplatePath` |

These subpaths are **server-only** (node `fs`/`crypto`) EXCEPT the browser-safe
`@mulmoclaude/core/whisper/client` and `@mulmoclaude/core/workspace-setup/slug` (not used by
this plan). The isomorphic `@mulmoclaude/core/collection` entry is also browser-safe. As
before, mirror the server subsystems' value types locally on the frontend rather than
importing them (so a server subpath never enters the browser bundle).

> If MulmoTerminal already imports `configureCollectionHost` /
> `discoverCollections` / `isSafeActionTemplatePath` from
> `@mulmoclaude/collection-plugin` or `@mulmoclaude/collection-plugin/server` (see the
> "Collection host" seam below), repoint those to `@mulmoclaude/core/collection`(+`/server`,
> +`/paths`) as part of this migration — `@mulmoclaude/collection-plugin` is now Vue-only.

## MulmoTerminal integration seams

Confirmed from the codebase (line numbers from the prior pass — symbols are stable, but
re-grep before editing since `main` has advanced):

- **Workspace root** — `CLAUDE_CWD` (`server/index.ts`), `process.env.CLAUDE_CWD ||
  path.join(os.homedir(), "mulmoclaude")`. The dir is `mkdir`'d at boot. NOTE: the
  launcher (`bin/mulmoterminal.js` `resolveCwd`) defaults `CLAUDE_CWD` to **the directory
  `npx mulmoterminal` ran from** (`--cwd > CLAUDE_CWD env > process.cwd()`), so it is
  often an arbitrary project dir, NOT `~/mulmoclaude`. This drives the seed-gating
  decision below.
- **Pubsub** — `server/pubsub.ts` `createPubSub(server, isAllowedOrigin)` → `{ publish(channel, data) }`.
  Frontend subscriber: `src/composables/usePubSub.ts` `usePubSub().subscribe(channel, cb)`.
  Plugin-runtime channel format: `src/composables/pluginRuntime.ts` `pluginChannelName(scope, event) = plugin:${scope}:${event}`; a plugin View's `runtime.pubsub.subscribe("file:<path>")` resolves to `plugin:<scope>:file:<path>`.
- **Logger** — no shared structured logger; a prefix-style `console` wrapper exists in
  `server/backends/collections.ts` (`log.{info,warn,error,debug}(prefix, msg, data?)`).
  Backends use `console.*` directly. Each binding defines its own small `[scope]`-prefixed
  console logger.
- **Atomic write** — no shared `writeFileAtomic`. Pattern (temp `${file}.${randomUUID()}.tmp`
  → `rename`, cleanup on error) exists inline in `server/backends/shortcuts.ts`. Each
  binding that needs it ships a tiny local copy.
- **Route mount** — `mountXRoutes(app)` functions called from `server/index.ts` (e.g.
  `mountCollectionRoutes(app)`).
- **Collection nav (frontend)** — `src/composables/useCollectionBrowse.ts`
  `browseNavigateToRecord(slug, recordId?)` opens a collection record.
- **Collection host** — already configured: `initCollectionsBackend({workspace})` in
  `server/backends/collections.ts` calls `configureCollectionHost(...)` with the
  MulmoClaude-matching path layout. (The watchers depend on this.) **Repoint its import**
  (and any `discoverCollections` / `loadCollection` / `isSafeActionTemplatePath`) from
  `@mulmoclaude/collection-plugin/server` → `@mulmoclaude/core/collection/server`
  (`isSafeActionTemplatePath` is at `@mulmoclaude/core/collection/paths`); the engine moved
  there and `@mulmoclaude/collection-plugin` is now Vue-only.
- **Toolbar** — `src/App.vue` `<header class="toolbar">` with a `.launcher` nav of
  `material-symbols-outlined` icon buttons (dark palette: bg `#16213e`, text `#e6e6f0`,
  muted `#9aa6cc`, hover `#26375f`, active `#2f59c0`).
- **Write sites** that should publish file-changes: `markdown.ts` `saveDoc`/`saveNewDoc`,
  `html.ts` `saveHtml` dispatch, `collections.ts` `writeItem`/`deleteItem` (no publish
  today), `artifacts.ts` chart writes (no publish today).

## Decisions already made

1. **Seed policy = managed workspace only.** Seed helps/presets ONLY when `CLAUDE_CWD` is
   the managed mulmoclaude workspace (`~/mulmoclaude`, or `MULMOCLAUDE_WORKSPACE_PATH`).
   Launching the terminal in an arbitrary project dir must NOT write mulmoclaude
   presets/helps there — especially since `syncActivePresetSkills` touches `.claude/skills`,
   which many dev repos already have. (Codex P2 on the first pass.)
2. **Notifier UI = bell + dropdown panel** (port MulmoClaude's model): a toolbar bell with
   a severity-coloured unread badge + a dropdown listing active notifications,
   click-to-navigate.
3. **Branch off CURRENT `main`, one PR per service.** The first-pass branches fell ~57
   commits behind a fast-moving `main`; redo from current `main` and keep PRs small.

## Review lessons to bake in up-front

- **Fault isolation at boot.** Any boot-time service init that does filesystem work must be
  wrapped so an FS edge case (EACCES/ENOSPC/path collision) logs + continues and never
  aborts server startup. Per-step isolation where practical.
- **MulmoTerminal lint** bans the `void` operator (`sonarjs/void-use`) and enforces
  `id-length ≥ 3` (exceptions `_ i j ok`) — including in test files. Also
  `security/detect-unsafe-regex` (avoid backtracking-prone regexes; prefer string ops),
  `import/no-duplicates`, `no-shadow`. Run `yarn lint` (it `--fix`es prettier).
- **Type mirrors on the frontend.** Don't import server-only packages into `src/`; mirror
  the small value types locally (matches MulmoClaude's `useNotifications`).
- **`build:packages` parity is N/A here** — MulmoTerminal consumes the services from npm,
  not as workspaces, so no dist-cache wiring is needed (that was a MulmoClaude concern).

## Implementation plan (risk-ordered, one PR each)

### PR 0 — ⚠️ BREAKING: repoint existing collection-engine imports (do FIRST)
MulmoTerminal **already** imports the collection engine from `@mulmoclaude/collection-plugin`,
which `@mulmoclaude/collection-plugin@0.5.9` REMOVED (it is now Vue-only). The moment install
resolves `0.5.9` (its `^0.5.1` range allows it), these imports throw
`ERR_PACKAGE_PATH_NOT_EXPORTED`. This is independent of the new-feature PRs below and must land
first.

**package.json:** ADD `@mulmoclaude/core@^0.2.0`, and **BUMP**
`@mulmoclaude/collection-plugin` `^0.5.1` → `^0.5.9`. The bump is REQUIRED, not optional:
`0.5.9`'s `/vue` host takes its response/schema types from a `@mulmoclaude/core: '*'`
**peerDependency** (so `/vue` and `@mulmoclaude/core/collection` agree on types), whereas
`0.5.1` ships its OWN embedded copy of those types, which has since diverged from
`core@0.2.0` (e.g. `CollectionEvery` → `CollectionSpawnEvery`). Pinning `0.5.1` while
importing `core@0.2.0` types into `collectionUi.ts` produces `TS2322` schema-mismatch
errors. The lockfile also holds `0.5.1` until the range is bumped — a plain `yarn install`
will NOT pull `0.5.9` on its own, so the "latent break" is really "breaks the moment the
range is raised or the lock is regenerated." Run `yarn install` after editing (switching
branches prunes the shared `node_modules`).

**Published-version context (as of 2026-06-25):** `@mulmoclaude/core@0.2.0` carries the engine
+ all former services as subpaths; `@mulmoclaude/collection-plugin@0.5.9` is Vue-only. The old
standalone service packages (`@mulmoclaude/{notifier,scheduler,whisper,workspace-setup,
file-change-publisher,skill-bridge,collection-watchers}`) remain published at their last
versions but are FROZEN — do not add them; use the `core` subpaths.

**Imports to repoint** — `server/backends/collections.ts`:
  - `@mulmoclaude/collection-plugin/server` → `@mulmoclaude/core/collection/server`
    (`configureCollectionHost`, `discoverCollections`, `loadCollection`, …).
  - `@mulmoclaude/collection-plugin` (`.`, e.g. `actionVisible`, `type CollectionItem`) →
    `@mulmoclaude/core/collection`.
  - any `isSafeActionTemplatePath` → `@mulmoclaude/core/collection/paths` (none today).
- **Repoint the DYNAMIC import in `plugins/plugins.json`** the original scope missed —
  the `presentCollection` server tool is loaded by `server/plugins-registry.ts`'s
  `loadPackage` via `await import(name)`, where `name` is the `"@mulmoclaude/collection-plugin"`
  string in the `packages` array. A bare `import()` of a string is NOT caught by a `from
  "..."` grep, so it survives a static-import-only sweep and then throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED` **at server boot** (not at typecheck/build). Change that
  array entry to `"@mulmoclaude/core/collection"`, where `TOOL_DEFINITION` (name
  `presentCollection`) + the sole `executePresentCollection` now live; `loadPackage` resolves
  the execute via its `soleExecuteStar` fallback. **Lesson: grep package-name STRINGS, not
  just `from`-imports** — `plugins.json`, dynamic `import()`, and `require()` all bypass a
  `from`-only sweep. Boot the server as part of PR-0 verification, not just typecheck/build.
- **Also repoint a FRONTEND bare-root import** the original scope missed —
  `src/composables/collectionUi.ts` imports `CollectionDetailResponse`,
  `CollectionsListResponse`, `CollectionNotifySeverity`, `ItemMutationResponse` from the
  bare `@mulmoclaude/collection-plugin` (`.`) root, which `0.5.9` also removed → repoint to
  `@mulmoclaude/core/collection`.
- **Implement the new `CollectionUi.startNewChatDraft` method** — `0.5.9`'s `/vue` host
  interface adds a required `startNewChatDraft(prompt, role?)` (open a chat with the prompt
  prefilled as an editable draft). MulmoTerminal terminals are PTYs with no editable
  composer draft, so degrade it to the same visible seeded chat as `startChat`
  (`startCollectionChat(prompt, { hidden: false })`); without it `yarn typecheck` fails.
- **Keep** the Vue/style imports on `@mulmoclaude/collection-plugin`: `…/vue`
  (`src/plugins-registry.ts`, `src/composables/collectionUi.ts`,
  `src/components/CollectionCardView.vue`, `src/components/CollectionsBrowseOverlay.vue`) and
  `…/style.css?inline` (`src/collectionShadowCss.ts`) — those still exist in 0.5.9.
- Re-grep `@mulmoclaude/collection-plugin` to confirm zero non-`/vue`, non-`/style.css`
  `from`-imports remain (the `"@mulmoclaude/collection-plugin"` plugin-registry KEY in
  `src/plugins-registry.ts` is a name, not an import — leave it). Verify `yarn typecheck`,
  `yarn lint`, `yarn test`, `yarn build`, + boot.

### PR 1 — workspace-setup (seed helps + preset skills)
- Add dep `@mulmoclaude/core@^0.2.0` (one dep, shared by every PR below); import from `@mulmoclaude/core/workspace-setup`.
- `server/backends/workspaceSetup.ts`:
  - `isManagedWorkspace(workspace)` — true only for `~/mulmoclaude` or
    `MULMOCLAUDE_WORKSPACE_PATH` (resolved compare).
  - `initWorkspaceSetup({workspace})` — early-return + log if not managed; otherwise
    `seedHelps` → `config/helps`, `syncPresetSkills` → `data/skills/catalog/preset`,
    `syncActivePresetSkills` → `.claude/skills`. Each step via a `safeStep(label, fn)`
    wrapper (log + continue; never throws).
- `server/index.ts`: `initWorkspaceSetup({ workspace: CLAUDE_CWD })` right after the
  workspace `mkdir`.
- Tests (`server/backends/workspaceSetup.spec.ts`): managed-vs-arbitrary detection;
  happy-path seeding into a managed workspace (helps `index.md` + `mc-*` presets land); NO
  writes into a non-managed cwd.
- **Destinations must match MulmoClaude's `WORKSPACE_DIRS` exactly**: `config/helps`,
  `data/skills/catalog/preset`, `.claude/skills`.

### PR 2 — file-change-publisher (close the markdown/html live-refresh path)
- Dep `@mulmoclaude/core@^0.2.0` (already added in PR 1); import from `@mulmoclaude/core/file-change`.
- `server/backends/fileChange.ts`: `initFileChangePublisher({workspace, pubsub})` →
  `configureFileChangePublisher` with `publish: pubsub.publish`, `workspaceRoot`,
  `toPosix` (split on `path.sep` → `/`), and `pluginScopes`:
  `[{scope:"markdown", matches: artifacts/documents/**.md}, {scope:"html", matches: **.html}]`.
  No `primaryChannel` (MulmoTerminal has no general files-explorer subscriber). Re-export
  `publishFileChange`.
- `server/index.ts`: `initFileChangePublisher({workspace: CLAUDE_CWD, pubsub})` right after
  `createPubSub`, before the write backends.
- `markdown.ts`: drop the hand-rolled `publishFileChange`/pubsub; route `saveDoc` AND
  `saveNewDoc` (the latter was an unpublished gap) through the shared `publishFileChange`.
- `html.ts`: drop the `getPubsub` thunk + manual stat/publish; route `saveHtml` through the
  shared `publishFileChange`.
- Tests: scope/channel correctness for md + html, no-publish for an unmatched path,
  out-of-workspace path dropped (the package contains the path).
- **Out of scope:** collection live-refresh. `@mulmoclaude/collection-plugin/vue`'s View has
  no file-change subscriber, so publishing on `writeItem`/`deleteItem` wouldn't refresh
  anything. Closing it needs a subscriber in the collection plugin (separate effort).

### PR 3 — notifier + collection-watchers + bell UI
- Dep `@mulmoclaude/core@^0.2.0` (already added); import from `@mulmoclaude/core/notifier` and `@mulmoclaude/core/collection-watchers`.
- **Server / notifier** (`server/backends/notifier.ts`): `configureNotifier` with
  `publishEvent → pubsub.publish(NOTIFIER_CHANNEL, event)`, a small atomic `writeJson`, and
  a `[notifier]` logger; `setNotifierFilePaths` to the **shared** `<ws>/data/notifier/{active,history}.json`
  (same paths as MulmoClaude). REST: `GET /api/notifications`, `GET .../history`,
  `POST .../:id/clear`.
- **Server / collection-watchers** (`server/backends/collectionWatchers.ts`):
  `configureCollectionWatchers` with a MulmoTerminal `CollectionNotificationAdapter`
  (pluginPkg `"collections"`, `priorityToSeverity` high→urgent/else→nudge,
  `buildNavigateTarget` → `/collections/<slug>?selected=<itemId>`, `buildPluginData`/`readEntry`
  round-tripping a `{kind:"collection-completion", legacyId, slug, itemId, priority}` shape).
  `startCollectionCompletionWatchers()` runs at boot **after** `initCollectionsBackend` +
  `initNotifier`, fire-and-forget + non-fatal (use `.catch`, NOT the `void` operator).
- **Boot order** (`server/index.ts`): `initNotifier` right after `createPubSub`;
  `mountNotificationRoutes(app)` with the other mounts; `startCollectionCompletionWatchers()`
  after `initCollectionsBackend`.
- **Frontend** (`src/composables/useNotifications.ts`): local mirror types; fetch
  `/api/notifications`, subscribe `NOTIFIER_CHANNEL`, apply published/updated/cleared/cancelled;
  expose `count`/`topSeverity`/`sorted`/`dismiss`/`activate`. Row click **navigates**
  (parse `/collections/<slug>?selected=<itemId>` via string ops — no regex — →
  `browseNavigateToRecord`) but does NOT clear (completion bells are action-lifecycle
  obligations the watcher clears when the record is done); a separate ✕ calls `clear`.
- **Frontend** (`src/components/NotificationBell.vue`): toolbar bell + severity-coloured
  badge + dropdown panel (title/body, severity dot, dismiss ✕, click-away backdrop),
  mounted at the right of the `App.vue` toolbar (`margin-left:auto`). Match the dark palette
  + Material Symbols convention.
- Tests: `parseCollectionTarget` unit tests; an end-to-end notifier smoke (publish → list →
  pubsub event → `active.json` written).

### PR 4a — scheduler: user-tasks → spawn chat (the portable half)
The scheduler splits cleanly: the **engine** (tick loop, daily/interval scheduling) is the
shared `@mulmoclaude/core/scheduler`; the task **run** logic is app-specific. MulmoClaude's
two task families differ in portability:
- **User tasks** (`config/scheduler/tasks.json`) — a record `{id,name,description,schedule,
  missedRunPolicy,enabled,roleId,prompt}`. MulmoClaude's `registerUserTasks` registers each
  enabled one on the task-manager with `run = startChat({message: prompt, roleId})`, i.e.
  the schedule fires and **spawns a new chat seeded with the prompt**. This is how the
  workout-log "週3回リマインダー" works: a daily 11:00 task whose prompt tells the agent to
  read `data/workout-log/items/` and nudge. The collection schema has NOTHING to do with it
  — the only link is the prompt text. **This half is portable**: the run-binding is exactly
  MulmoTerminal's `spawnBackgroundChat` (`spawnClaudePty`).
- **System tasks** (feed-refresh / journal / chat-index) — `run` calls MulmoClaude-only
  functions (`refreshDueFeeds`, `maybeRunJournal`, `backfillAllSessions`) NOT in the shared
  package. Split out: **PR 4b** = RSS/JSON feed-refresh (needs the feed engine extracted into
  `@mulmoclaude/core/feeds` first); **PR 4c** = journal + chat-index (tied to MulmoClaude's
  chat-session model — needs a mapping decision).

**PR 4a scope (this PR):**
- Add dep `@receptron/task-scheduler@^0.1.0` (a `*` peerDependency of `@mulmoclaude/core`,
  used by `@mulmoclaude/core/scheduler` — not auto-installed). `@mulmoclaude/core` already present.
- `server/backends/scheduler.ts`:
  - Load + validate user tasks from `<ws>/config/scheduler/tasks.json` (mirror MulmoClaude's
    validation: `schedule` is `{type:"interval",intervalMs>0}` or `{type:"daily",time:"HH:MM"}`
    — validate HH:MM with **string ops, no regex**; `prompt` non-empty; skip `enabled:false`).
  - `initUserTaskScheduler({workspace, spawnChat, log?})` → `createTaskManager`, register each
    enabled task as `{id:"user.<id>", description, schedule, run: async () => spawnChat(prompt)}`,
    `taskManager.start()`. Registered DIRECTLY on the task-manager (matches MulmoClaude — user
    tasks don't go through `initScheduler`/`SystemTaskDef`, so no system-task persistence/catch-up;
    they fire forward on schedule).
  - `mountSchedulerRoutes(app, {workspace})` → `GET /api/scheduler/tasks` (read-only list from
    tasks.json). CRUD + a tasks UI is **PR 4d** (not needed to make existing tasks run).
- `server/index.ts`: define `spawnScheduledChat(message)` (= `randomUUID()` + `spawnClaudePty(id,
  null, null, message)`, VISIBLE so the user sees the nudge) and pass it as `spawnChat`; call
  `initUserTaskScheduler` + `mountSchedulerRoutes` near boot, fire-and-forget + non-fatal.
- Tests: schedule/prompt/enabled validation; registration count; `run` invokes `spawnChat`;
  malformed/missing `tasks.json` tolerated (no throw); list route shape.
- **Out of scope (4a):** system tasks (4b), task CRUD + UI (4c), missed-run catch-up across
  restarts (user tasks fire forward only, matching MulmoClaude).

### PR 4b — scheduler system task: RSS/JSON feed-refresh
Add ONE `system:feed-refresh` task so a MulmoTerminal-alone run keeps feed-backed
collections fresh (RSS / JSON data-sources fetched into their collections, hourly).

**Hard prerequisite — a MulmoClaude-side extraction (separate change, lands + PUBLISHES
FIRST; cannot be built or verified from a MulmoTerminal branch).** Decided approach
(2026-06-25): **extract into `@mulmoclaude/core/feeds`** (share, don't reimplement), matching
how the other five subsystems were shared.

#### Step 1 — MulmoClaude: extract `server/workspace/feeds/` → `packages/core/src/feeds/`
The engine is ~1.3k LOC across: `engine.ts` (`refreshDue`/`refreshOne`/`RefreshResult`),
`retrievers/` (`rss`, `httpJson`, `index`, `registerAll`), `fetch/` (`httpClient`,
`rssParser`), `ingestTypes.ts`, `registry.ts` (`listFeeds`/`removeFeed`), `state.ts`
(`readFeedState`/`writeFeedState`), `paths.ts`, `pathResolver.ts`, `projectItem.ts`, `index.ts`.

Dependency audit (what blocks a clean move):
- **Already shareable, keep as-is:** `@mulmoclaude/core/collection`(+`/server`) — the engine
  already imports `deleteItem`/`listItems`/`writeItem`/types from there (post-consolidation),
  plus `fast-xml-parser` and node builtins (`crypto`/`dns/promises`/`net`/`fs/promises`/`path`).
- **Replace with injected host bindings** via a `configureFeeds({...})` seam (mirrors
  `configureCollectionHost` / `configureNotifier` / `configureScheduler`):
  - `../../workspace/workspace.js` `workspacePath` → `cfg.workspaceRoot` (the feeds + state
    paths in `paths.ts`/`pathResolver.ts` hang off it).
  - `../../system/logger` `log` → `cfg.log` (the `SchedulerLogger`-style `{info,warn,error}`).
  - `../../utils/files/atomic.js` (atomic write, used by `state.ts`) → `cfg.writeFileAtomic`.
  - `../../utils/time.js` `ONE_HOUR_MS`/`ONE_DAY_MS` → inline consts in core (trivial; or a
    `core/util/time`).
  - `../../utils/types.js` (`isRecord` etc.) → inline in core (trivial).
- Add the `./feeds` + (if needed) `./feeds/server` subpath exports to
  `@mulmoclaude/core/package.json` `exports`; declare `fast-xml-parser` a dependency of core.
  Re-export the public surface (`refreshDue`, `refreshOne`, `RefreshResult`, `listFeeds`,
  `removeFeed`, `feedsRoot`/`feedDir`/`feedStatePath`/`FEEDS_DIR`, `readFeedState`/`FeedState`,
  `INGEST_KINDS`/`FEED_SCHEDULES`/`isFeedSchedule`/`IngestSpec`/`IngestKind`/`FeedSchedule`).
- **Repoint MulmoClaude's `server/workspace/feeds/index.ts`** to a thin re-export of
  `@mulmoclaude/core/feeds` + a module-load `configureFeeds({workspaceRoot: workspacePath,
  writeFileAtomic, log})` (same shim pattern MulmoClaude uses for collections/notifier/scheduler).
  All existing feed routes/tests keep importing from `./workspace/feeds/index.js` unchanged and
  stay green. The `system:feed-refresh` task in MulmoClaude's `server/index.ts` is unaffected.
- CI gotchas (reuse from the prior service extractions): `build:packages` must build the new
  `feeds` entry; the dist-cache key must include it; publish-smoke does a real `npm install`, so
  `fast-xml-parser` must be a declared dep of core. **Publish a new `@mulmoclaude/core`.**

#### Step 2 — MulmoTerminal (the actual PR 4b, AFTER step 1 ships): wire the task
  - bump `@mulmoclaude/core`, add `fast-xml-parser` if not transitive,
     `server/backends/feeds.ts`: `configureFeeds({...})` at boot (workspaceRoot=CLAUDE_CWD, the
     same atomic-write + console-logger bindings the other backends use). Register a
     `SystemTaskDef` `{id:"system:feed-refresh", schedule:{interval, ONE_HOUR_MS},
     missedRunPolicy:"runOnce", run: () => refreshDue().then(()=>{})}` via `initScheduler`
     (system tasks DO get persistence/catch-up, unlike the 4a user tasks). Wire the existing
     feed collections' write-side (`listFeeds`/`refreshCollection` in `collectionUi.ts`, today
     stubbed) to the live refresh.
- Tests: a `refreshDue` smoke against a temp workspace with a fixture feed; the system-task
  registration; tolerate a no-feeds workspace (no-op).
- **Blocked on step 1** (a MulmoClaude change + a core publish) — cannot be built/verified in a
  MulmoTerminal branch alone.

### PR 4c — scheduler system tasks: journal + chat-index (deferred)
`maybeRunJournal` (summarize chat sessions → daily/topic files) + `backfillAllSessions` (AI
titles/summaries for un-indexed sessions). Both `run` MulmoClaude-app-specific logic tied to
its chat-session model; whether they map to MulmoTerminal's PTY-session model needs a decision.
Lower value than feed-refresh for a MulmoTerminal-alone run; defer until wanted.

### PR 4d — scheduler task CRUD + tasks UI (deferred)
Create / edit / delete / run-now of `config/scheduler/tasks.json` entries from the UI (today
they must be hand-authored or written by the agent), plus a tasks pane. Mirrors MulmoClaude's
`/api/scheduler/tasks` CRUD + the automations view. Existing tasks already RUN without this
(PR 4a); this is the authoring surface.

### PR 5 — skill-bridge (deferred)
- Needs a `data/skills` convention + a `/api/hook` PostToolUse handler that calls
  `mirrorSkillWrite`/`mirrorSkillDelete`. The hook plumbing exists (`hookSettingsJson()` +
  the `/api/hook` route); defer until the skill-authoring flow in MulmoTerminal is wanted.

## Per-PR verification

For every PR: `yarn typecheck` (vue-tsc -b), `yarn lint`, `yarn test` (vitest), `yarn build`
(must bundle), plus a focused functional smoke (a tsx/vitest exercise of the new binding
against a temp workspace). CI gates: `lint-and-build`, `package-smoke`, `codex-review`.

## Open questions / deferred

- **Collection live-refresh** — gated on the `collection-plugin/vue` View gaining a file-change
  subscriber; out of scope here.
- **Scheduler system tasks** — which tasks (feeds/journal/user-cron) are meaningful in
  MulmoTerminal, and the run-job binding shape (`spawnBackgroundChat`).
- **skill-bridge** — only if MulmoTerminal grows skill authoring.
- **Notifier dedup across apps** — both apps share `data/notifier/`; since they never run
  simultaneously this is fine, but worth a note if that ever changes.

## Sequencing notes

- Branch each PR off **current `main`** (it moves fast). Keep PRs small + independent.
- Switching branches prunes npm deps from the shared `node_modules`; run `yarn install`
  after each checkout before testing.
