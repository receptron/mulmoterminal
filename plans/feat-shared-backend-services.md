# feat: wire MulmoClaude's shared backend services into MulmoTerminal

## Goal

MulmoClaude extracted its **headless backend behavior** into six reusable
`packages/services/*` packages (MulmoClaude PR #1733, published to npm). This plan wires
them into MulmoTerminal so a **MulmoTerminal-alone run** (the user never boots MulmoClaude)
still gets the full workspace experience — seeded helps/presets, live-refresh on writes,
notifications, completion bells — instead of an empty, inert workspace.

Both apps share one workspace (`CLAUDE_CWD`, default `~/mulmoclaude`) and never run
simultaneously, so the services are safe to share with **no locking**. Each service is
consumed through a **thin host binding** under `server/backends/*` that injects
MulmoTerminal's specifics (pubsub, workspace root, logger, routes, navigation).

This is a **restart**: a first pass shipped as PRs #63/#64/#65 (now closed) and gathered
review feedback. That feedback is folded into this plan up-front so the redo lands clean.

## The six shared packages (published on npm)

| Package | Version | Role | Key API |
|---|---|---|---|
| `@mulmoclaude/workspace-setup` | `^0.1.1` | seed helps + preset skills at boot | `seedHelps({destDir})`, `syncPresetSkills({sourceDir,destDir,onInfo,onWarn})`, `syncActivePresetSkills({sourceDir,activeDir,...})`, `presetSkillsAssetDir()`, `helpsAssetDir()`, `isPresetSlug()` |
| `@mulmoclaude/file-change-publisher` | `^0.1.1` | broadcast "workspace file changed" to pubsub | `configureFileChangePublisher({publish,workspaceRoot,toPosix,primaryChannel?,pluginScopes?,onPublished?,warn?})`, `publishFileChange(rel)`, `pluginFileChannel(scope,posix)` |
| `@mulmoclaude/notifier` | `^0.1.0` | active+history notification engine | `configureNotifier({writeJson,publishEvent,log?})`, `setNotifierFilePaths({active,history})`, `publish`/`clear`/`cancel`/`listAll`/`listHistory`/`listFor`/`updateForPlugin`/`onEvent`, `NotifierEvent` |
| `@mulmoclaude/collection-watchers` | `^0.1.0` | fs.watch per collection → completion bells via the notifier | `configureCollectionWatchers({adapter,log})`, `startCollectionWatchers(opts)`, `CollectionNotificationAdapter`, `CompletionPriority` |
| `@mulmoclaude/scheduler` | `^0.1.0` | cron tick engine + persistence adapter | `createTaskManager({log})`, `configureScheduler({workspaceRoot,writeFileAtomic,log})`, `initScheduler(taskManager,systemTasks)` |
| `@mulmoclaude/skill-bridge` | `^0.1.0` | mirror `data/skills/<slug>/` → `.claude/skills/` (PostToolUse rule) | `bridgeTargetFromDataPath`, `slugFromRmCommand`, `mirrorSkillWrite`, `mirrorSkillDelete` |

All are **server-only** (node `fs`/`crypto`); their value types are mirrored locally on
the frontend rather than imported (so a server package never enters the browser bundle).

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
  MulmoClaude-matching path layout. (The watchers depend on this.)
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

### PR 1 — workspace-setup (seed helps + preset skills)
- Add dep `@mulmoclaude/workspace-setup@^0.1.1`.
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
- Add dep `@mulmoclaude/file-change-publisher@^0.1.1`.
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
- **Out of scope:** collection live-refresh. `@mulmoclaude/collection-plugin`'s View has
  no file-change subscriber, so publishing on `writeItem`/`deleteItem` wouldn't refresh
  anything. Closing it needs a subscriber in the collection plugin (separate effort).

### PR 3 — notifier + collection-watchers + bell UI
- Add deps `@mulmoclaude/notifier@^0.1.0`, `@mulmoclaude/collection-watchers@^0.1.0`.
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

### PR 4 — scheduler (deferred; needs decisions)
- Engine + adapter are ready; wiring needs (a) a **run-job binding** — MulmoTerminal's
  analog is `spawnBackgroundChat` (`POST /api/plugin/spawnBackgroundChat`) — and (b) a
  decision on **which system tasks** make sense in MulmoTerminal (feeds refresh? journal?
  none yet?). Defer until 1–3 land and the task set is decided.

### PR 5 — skill-bridge (deferred)
- Needs a `data/skills` convention + a `/api/hook` PostToolUse handler that calls
  `mirrorSkillWrite`/`mirrorSkillDelete`. The hook plumbing exists (`hookSettingsJson()` +
  the `/api/hook` route); defer until the skill-authoring flow in MulmoTerminal is wanted.

## Per-PR verification

For every PR: `yarn typecheck` (vue-tsc -b), `yarn lint`, `yarn test` (vitest), `yarn build`
(must bundle), plus a focused functional smoke (a tsx/vitest exercise of the new binding
against a temp workspace). CI gates: `lint-and-build`, `package-smoke`, `codex-review`.

## Open questions / deferred

- **Collection live-refresh** — gated on the collection-plugin View gaining a file-change
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
