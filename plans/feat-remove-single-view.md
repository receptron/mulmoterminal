# feat: eliminate the single-terminal view; the grid becomes the only view

## The observation this starts from

A grid cell whose cwd is the default workspace (`CLAUDE_CWD`) is already almost the single
view: same PTY, same `spawnClaudePty`, same agent, and since #1000 / #1032 / #1040 / #1071 the
same Canvas and GUI tool groups beside a zoomed cell.

What separates them is **one query parameter**. `?gui=0` (`attachGuiMcp`,
`server/routes/ws-routes.ts:282`) is set by every grid cell (`TerminalCell.vue:1086` passes
`dev-terminal` unconditionally → `wsUrl.ts:30`) and omitted by the single view. That one flag
currently decides five unrelated things:

| # | What `attachGuiMcp` decides | Where |
|---|---|---|
| 1 | MCP surface: full `--mcp-config` + `GUI_MCP_TOOLS` + user MCP servers, vs. the directory's own `.mcp.json` + `GRID_MCP_TOOLS` | `spawn-claude.ts:123,142`, `index.ts:185,193` |
| 2 | Docker sandbox eligibility | `pty-spawn.ts:59` (`sandboxWouldRun`) |
| 3 | tmux persistence (the inverse — sandbox and tmux are exclusive spawn wrappers) | `spawn-claude.ts:~148`, `plans/feat-202-docker-sandbox-mcp.md:7` |
| 4 | Whether the session is hidden from `/api/sessions` (`markDevTerminalSession`) | `ws-routes.ts:303,462,531` |
| 5 | The session's initial `active` (= "the user is looking at it", drives waiting/attention) | `ws-routes.ts:349,514` |

Plus client-side: `Terminal.vue:177` (`gitCwd` null for dev terminals) and
`terminalViewActive.ts:14` (a dev-terminal cell is "active" only when expanded).

## Decisions (owner, this session)

1. **MCP surface** — a grid cell **at `{workspace}`** gets the full GUI MCP, by **default auto
   configuration** (no opt-in, no launcher checkbox). **Normal grid cells do not change at all**
   — they keep `GRID_MCP_TOOLS` and the directory's own `.mcp.json`.
2. **Docker sandbox** — **cut the feature.** It is opt-in (`MULMOTERMINAL_SANDBOX=1`, default
   off, `sandbox.ts:31`), macOS-only, and its exclusivity with tmux is the only thing making
   "persistent AND fully-tooled" impossible.
3. **tmux persistence** — by design; it stays, and with the sandbox gone nothing contends with it.

**The discriminator is the cwd, not the view.** This is what keeps the change small: of the five
jobs `attachGuiMcp` does today, only #1 moves. #2 is deleted. #3 is already right. **#4 and #5
stay keyed on "is this a grid cell", exactly as now** — so the workspace cell remains hidden from
`/api/sessions` and starts inactive like any other cell, and no attention/waiting behaviour is
touched. The earlier draft of this plan proposed re-basing #4/#5 for every cell; that is no longer
needed and should not be done.

## The invariant: a normal terminal does not change. At all.

**This overrides every other goal in this plan.** A grid cell whose cwd is not `{workspace}`
must behave after all five PRs exactly as it does today — same claude argv, same MCP servers,
same tmux reattach, same session-list visibility, same attention/waiting, same reload.
If a step cannot be taken without touching them, the step does not happen.

Make it checkable, not just asserted:

- **Characterization spec on `buildClaudeArgs`.** Snapshot the argv for a non-workspace cwd
  before PR2 and assert it is unchanged after — including `--allowedTools`, the absence of
  `--mcp-config`, and `--strict-mcp-config`. This is the single highest-value test in the whole
  plan: it is exactly where a "small" refactor leaks.
- **The same for the codex and antigravity spawns** (`spawn-codex.ts:73`), which take the same
  flag.
- **PR1 costs nothing here by construction**: `sandboxWouldRun` already requires `attachGuiMcp`
  (`pty-spawn.ts:59`), so a grid cell has *never* been sandboxed. Deleting the sandbox cannot
  reach them. Worth saying in the PR body, because "we removed the sandbox" otherwise sounds
  like it might.
- **Renames are allowed, re-decisions are not.** PR2 renames the `gui` wire flag to say "grid
  cell"; the value each consumer computes must be identical. Land the rename as its own commit
  with no behaviour delta so the diff can be read as such.
- **Nothing new keys off "grid cell".** The temptation in PR3/PR4 will be to hang a new
  behaviour off the flag while it is already being touched. Don't.

Where each PR touches shared code, the audit is: PR1 — no path a grid cell can reach. PR2 —
derivation only, guarded by the spec above. PR3 — *adds* cells, changes none; reconciliation is
scoped (see below) so an existing cell's reload is untouched. PR4 — moves overlays, which are
app-level and render above the grid either way. PR5 — deletes single-view-only code.

## What identifies the workspace cell

`CLAUDE_CWD` (`server/config/env.ts:36`, default `~/mulmoclaude`) is server truth, and
`spawnClaudePty` already has both it and the session's `cwd` in scope
(`spawn-claude.ts:98`) — so the whole rule is server-side and the client sends nothing new.

Three things to get right, each of which silently produces "the feature just doesn't turn on":

- **An empty cwd IS the workspace.** The launch form's blank field means "the server's default"
  (`CellLaunchForm.vue:64`), and `spawnClaudePty` defaults `cwd = CLAUDE_CWD`. That cell must
  match.
- **Canonicalise before comparing.** The cwd arrives from a `?cwd=` query built from a user
  preset: trailing slash, `..`, and above all **symlinks** (a `~/mulmoclaude` that is a symlink is
  normal on this machine). Compare `realpathSync` of both sides, and fall back to a normalised
  string compare when the path does not exist rather than throwing.
- **Subdirectories do not count.** `{workspace}/foo` is a normal cell. Equality, not prefix.

**Multiple workspace cells are required, not merely tolerated** (owner). Each gets its own full
GUI MCP; the broker is already per-session (`/mcp/:sessionId`), so nothing needs to change for
this. The singularity of the single view was an artifact of it being a view.

## Every programmatic chat becomes a grid cell (owner)

This is the requirement that makes the workspace cell more than a convenience: **all
programmatically started chats run in the grid.** They already spawn at `CLAUDE_CWD` with no
`cwd` option, so under the PR2 rule they are workspace cells and get the full GUI MCP for free —
no call site changes for the MCP half.

The six spawn sites, all `spawnClaudePty(id, null, null, …)` with the default cwd:

| Site | What it is | Visible? |
|---|---|---|
| `index.ts:320` | translation worker | **hidden** — must stay cell-less |
| `index.ts:543` | feeds / collection refresh worker | `hidden` flag decides |
| `index.ts:561` | remote-host `spawnChat` (phone) | visible |
| `index.ts:774` | `spawnScheduledChat` (user cron tasks) | visible |
| `plugin-routes.ts:63,64` | `spawnBackgroundChat` tool (claude-draft / -run) | `hidden` flag decides |
| `GridView.vue:494` | Settings skill button | visible, already placed as a cell |

**The hard part: the grid lives in the browser.** A cell exists because `GridView`'s
localStorage state (`GridView.vue:75`) says so. The host cannot open one — `index.ts:686` says
this outright — which is why the phone's request goes out over `LAUNCH_TERMINAL_CHANNEL` to
*one* tab (`publishToOne`, `index.ts:699`) and fails with `NO_BROWSER_ERROR` when no tab is
listening. A server-spawned session today therefore appears **nowhere in the grid**; only
`launchSkill` gets a cell, and only because the browser initiated the spawn and then adopted it
(`GridView.vue:494-507`).

So two mechanisms are needed, and the second is the one that actually makes this reliable:

1. **A placement channel** — like `LAUNCH_TERMINAL_CHANNEL` but carrying an *existing*
   `sessionId` to adopt rather than a cwd to spawn at. `publishToOne`, same reasoning: a
   broadcast would place one cell per open tab.
2. **Reconciliation on grid load** — visible, non-hidden sessions the server knows about that
   are absent from this tab's state get cells. Without this, anything spawned while no browser
   was open (a cron task at 3am — the common case) is invisible forever. This also makes #1 a
   latency optimisation rather than the correctness mechanism, which is the right split.

Excluded from placement: hidden workers. They are already marked — `runWithHiddenMarker` /
`backgroundMarkers` (`index.ts:543`), `scheduledSessions.register`, `hidden: true` in
`background-chat.ts:14` — and `session-list.ts:17` already keeps them behind a Background
filter. Pin the exclusion with a spec; a translation worker acquiring a visible cell would be an
obvious regression and an easy one to cause.

**The 81-cell cap needs a real answer.** `insertCellAfter` silently returns the state unchanged
when the grid is full, and today's fallback is `showSpawnedSession` → the single view
(`GridView.vue:505`), which is exactly what is being deleted. Options: refuse the spawn and say
so in the text `spawnBackgroundChat` returns to the calling agent (it is a tool result, so the
agent can react); or park the session in an "unplaced" list the grid can pull from. Owner's
call — but note that "silently nowhere" is the current failure mode and must not be the one that
survives.

## Sequencing

Five PRs. The order is load-bearing: the single view cannot be deleted while it is the only
place five overlays render, nor while it is where a programmatic chat lands.

### PR1 — cut the sandbox

Pure deletion, independent of everything else, no user-visible change with the flag off.

- Delete `server/infra/sandbox.ts` (384 lines), `test/server/infra/sandbox.spec.ts` (242),
  `Dockerfile.sandbox` and the `~/.mulmoterminal/sandbox` scratch dir it writes.
- `pty-spawn.ts` — drop `sandboxWouldRun` / `spawnSandboxEntry`; `ptySpawn` keeps the tmux path only.
- `spawn-claude.ts:105-123` — the `sandbox` local, `SANDBOX_HOST` in `hookSettingsJson` /
  `mcpConfigJson` (both revert to `localhost` / `127.0.0.1`).
- `ws-routes.ts:315` — the `live?.sandbox || sandboxWouldRun(...)` refusal branch.
- `server/index.ts:866-877` — the boot-time sandbox diagnostics.
- `bin/mulmoterminal.js` — any doctor line about Docker / the sandbox image.
- Grep for the env names before declaring done: `MULMOTERMINAL_SANDBOX`,
  `MULMOTERMINAL_SANDBOX_IMAGE`, `SANDBOX_MOUNT_CONFIGS`, `SANDBOX_SSH_AGENT_FORWARD` — these
  are documented, so README / docs guide / `mulmoterminal-model` + `-bug-report` skills need the
  same sweep. Removing a documented env var is a changelog line.

### PR2 — the workspace cell gets the full GUI MCP — **DONE**

Implemented as described below, with three changes to what was planned:

1. **The wire flag was NOT renamed.** `attachGuiMcp` keeps its name and its meaning ("not a grid
   cell"); the derivation is a named, exported predicate instead —
   `carriesFullGuiMcp(attachGuiMcp, cwd)` in `spawn-claude.ts`. Exported so the invariant is
   assertable: `test/server/session/full-gui-mcp.spec.ts` pins that a project-directory cell is
   false. A rename would have touched the codex and antigravity paths for no behaviour change.
2. **`--strict-mcp-config` stays on for the workspace cell**, which means its directory's OWN
   `.mcp.json` servers do not load there — the single view's behaviour exactly. This is the one
   real trade in PR2 and it was not called out in the original plan. It is right because the
   point is parity with the view being deleted, and because dropping strict would double-register
   the GUI MCP for a workspace directory that had also registered group URLs: the agent would see
   `mcp__mulmoterminal-gui__presentChart` AND `mcp__mulmoterminal-render__presentChart`.
3. **codex and antigravity are deliberately left grid-only**, with the reason in a comment at
   `spawn-codex.ts`. The rule exists to make a workspace cell equivalent to the SINGLE VIEW, and
   the single view only ever ran claude — so there is no codex behaviour to preserve, and applying
   it would be a new capability rather than a migrated one.

Confirmed rather than assumed: the per-session MCP config file is already reaped for every kind of
session — `cleanupSessionSettings` removes it and runs from `lifecycle.ts` reap plus the boot
sweep, so the extra files a workspace cell now writes need no new cleanup.

---

### PR2 — the workspace cell gets the full GUI MCP

Small and server-side. The wire flag keeps its current meaning; what changes is that the MCP
decision stops reading it.

- **Separate the two facts.** `?gui=0` (`ws-routes.ts:282`) keeps meaning *"this is a grid
  cell"* and keeps driving `markDevTerminalSession` (:303) and `entry.active` (:349) for every
  cell including the workspace one — untouched, so normal cells are bit-for-bit unchanged.
  Rename it to say so (`gridCell` / `isGridCell`); `attachGuiMcp` becomes a derived value.
- **Derive the MCP surface from the cwd**, inside `spawnClaudePty` where both values already
  live: `const fullGuiMcp = isWorkspaceCwd(cwd)`. That single value then feeds the two places
  that read `attachGuiMcp` today — `mcpConfig` (`spawn-claude.ts:123`) and `allowedTools`
  (:142). `GRID_MCP_TOOLS`, `autoAllowedToolNames()` and `spawn-deps.ts:15` all **stay**: they
  are still what a normal cell gets.
- **Put `isWorkspaceCwd` in one place with its own spec** — the canonicalisation rules above
  (empty = workspace, realpath, equality not prefix) are exactly the kind of thing that gets
  re-implemented slightly differently in a second call site. `server/config/env.ts` next to
  `CLAUDE_CWD` is the natural home.
- **Per-session MCP config file** (`mcpConfigArgument` → `mcp-config.ts`): now written for
  workspace cells too. It was already written for every single-view session, so the volume is
  comparable — but confirm `fs-cleanup.ts` reaps them for grid sessions as well.
- **codex / antigravity**: `spawn-codex.ts:73` (`allTools`) and the antigravity path take the
  same flag. Apply the same derivation so a codex cell at `{workspace}` behaves like a claude
  one — or decide explicitly to leave them grid-only, and say so in a comment.
- The per-project registered-groups path (#1040, `registeredGuiMcpGroups`,
  `ws-routes.ts:443,469,538`) is **unaffected** and stays: it is how a normal cell gets Canvas.

### PR3 — programmatic chats land in the grid — **START HERE**

Independent of PR2 (placement is not MCP) and of PR1. Done first it fixes a defect that exists
today: the grid renders only its own localStorage cells (`GridView.vue:75`), so a session spawned
by the scheduler, the feeds worker or the phone appears **nowhere** in grid mode — it is reachable
only from the single view's sidebar. It is also the only step that could invalidate the rest of
the plan, so it belongs first.

Doing it first also **defers the 81-cell cap question** instead of blocking on it: the existing
`showSpawnedSession` → single view fallback (`GridView.vue:507`) is still there and stays
untouched until PR5, which is where the cap must actually be answered.

Split in two.

#### PR3a — placement channel + one choke point

**Every chat started from the collection UI goes through `startCollectionChat`**
(`useChatLauncher.ts`), so re-pointing that one function's "show it" step covers all of them:

- the collections index "create" button, a collection action, a record action → the plugin's
  `startChat` capability (`collectionUi.ts:234`);
- the new-collection template cards and **custom views** → `startNewChatDraft`
  (`collectionUi.ts:239`). The custom-view path starts inside a sandboxed iframe, which
  postMessages `mc-start-chat` (`customViewSrcdoc.ts:69`) to the plugin, which then calls the
  same host capability — so it converges here too and needs no separate handling.
- the Settings skill buttons (`App.vue:231`, `GridView.vue:497`).

`registerChatOpener` (`App.vue:284`) is what currently means "show it in the single view". That
registration is the seam: point it at grid placement and every caller above follows, with no
per-call-site changes. Keep the draft path intact — a `draft:true` spawn has the text typed into
the PTY without an Enter, and the adopting cell must show it that way.

#### PR3a-2 — the placed cell shows the collection it came from

A chat started from a record view must not land in a cell with an empty Canvas: the user was
looking at something, and the context is the point. So placement carries a Canvas seed.

**The mechanism already exists and needs no agent round-trip.** `storeToolResult(sessionId,
result)` (`tool-store.ts:160`) is host-callable, deduped by uuid, disk-backed and publishes to
the panel — the same store the broker writes through. Placing a cell can append a synthetic
`presentCollection` result for the new session, and the panel replays it like any other.

**The rule — parse the subject out of the SEED PROMPT, not the route.** This replaces an earlier
proposal here to read `browseRouteSlug()` / `browseRouteSelectedId()` at spawn time. That would
have worked, but MulmoClaude already ships this exact feature (its #1768) and takes the subject
from the prompt, which is better on three counts:

- **It survives navigation.** `placeSpawnedChat` pushes to `/terminals` when no grid is mounted,
  and the route watcher in `useCollectionBrowse.ts:34` clears the open record on any path change.
  Route-derived state is gone by the time the spawn resolves; the prompt travels with it.
- **It covers every entry point with one rule**, including the ones that have no route to read —
  a custom view's iframe button, a template card.
- **It cannot disagree with what the agent does.** The seed prompt is what the agent acts on, so
  parsing the same string is the same subject by construction.

It works because a collection IS a skill: the shared `CollectionView.buildChatSeed` builds
`/<slug> <message>` (and `/<slug> id=<itemId> …` for a record). A **feed** gets prose with no
slash command, and the collections index / template cards / skill buttons / cron send no slash
command either — so "no subject yet" falls out of the parse rather than needing a case.

| Started from | Seed prompt | Canvas seed |
|---|---|---|
| a collection record | `/<slug> id=<itemId> …` | that record |
| a collection | `/<slug> …` | that collection |
| a feed | prose naming the data path | nothing |
| the index / a template card / a skill button / cron | no slash command | nothing |

**Follow `../mulmoclaude/src/utils/collections/presentSeed.ts`.** Per the reference-host rule, that
file is the authority, and three of its decisions are behaviour rather than style:

- **The payload is tiny** — `{ collectionSlug, itemId? }`. The card SELF-FETCHES from the slug, so
  seeding needs no collection data at all. `PresentCollectionData` and the tool name both come from
  `@mulmoclaude/core/collection`, which we already depend on: **no upstream change is needed.**
- **Validate the slug against the real collection list before seeding.** Otherwise a non-collection
  slash command flashes a "not found" canvas.
- **The placeholder is superseded, not stacked.** When the agent's real `presentCollection` lands,
  the synthetic one for that slug is dropped.

**Where MulmoTerminal must diverge, and it is not optional.** MulmoClaude holds tool results in an
in-memory `ActiveSession` and reconciles in `eventDispatch`. MulmoTerminal's live server-side in
`toolResultsStore`, deduped **by uuid** (`tool-store.ts:160`). So:

- seeding is a POST to `/api/agent/toolResult` for the new `chatId`, not a client-side array push;
- the real result carries its own uuid, so uuid-dedupe will NOT collapse the pair — the reconcile
  has to be written, in `storeToolResult`, dropping a synthetic entry with the same
  `collectionSlug` when a real `presentCollection` arrives. Skipping it stacks two cards.

Mark the synthetic entry so it is identifiable (MulmoClaude uses a `syntheticCollection: true`
flag). Unlike there, ours is persisted to disk, so the flag has to survive a round trip through the
store — it is not client-only here.

**Blockers — both now resolved:**

1. ~~**`presentCollection` is in the `data` group, not `canvas`**~~ — **RESOLVED, and it was not
   the gate that was wrong.** Reported live: a chat started from the collections UI landed in the
   grid as intended but had no Canvas at all, not even for `render` tools. The cause is that a
   programmatically spawned chat is spawned with the **whole** GUI MCP on `--mcp-config`
   (`spawnClaudePty`'s `attachGuiMcp` defaults to true) and then ADOPTED as a grid cell, so it
   attaches with `?gui=0` and is marked a grid session — at which point `narrowedTools`' rule
   ("grid cell + no groups learned = has nothing") withholds every tool from a session holding
   every tool there is.

   Fixed at the source of the fact: `/api/mcp/:sessionId`, the all-tools URL, now records
   **`TOOL_GROUPS`** — reaching it is proof of the full MCP, since only `--mcp-config` hands it
   out. `data` therefore comes along with the rest and needs no per-cell widening, and
   `hasCanvasGroup` is untouched. Normal grid cells never reach that URL, so the invariant holds
   by construction rather than by a conditional.
2. ~~**The renderer has to be mounted on the grid path.**~~ — **RESOLVED: it already is, and there
   is no grid-specific path to mount.** Checked rather than assumed, as this section demanded:

   - the grid's Canvas renders the **same component** as the single view — `TerminalGrid.vue:849`
     mounts `<GuiPanel>`, the one `App.vue:398` mounts;
   - `GuiPanel` takes only `sessionId` and reads the shared plugin registry — it has no notion of
     which view it is in;
   - the collection engine is configured **globally at app boot** by `main.ts:6` importing
     `./composables/collectionUi` for its side effect, not per view or per panel.

   So a `presentCollection` result renders in a grid cell exactly as it does in the single view.
   Nothing to build here; the seeding work is all that is left.

#### PR3b — the durable half

The server-side unplaced marker + reconciliation on grid load, i.e. the case where no tab was
open at all. Details below.

- **Placement channel**: a new pub/sub channel carrying `{ sessionId, agent, cwd }` for a session
  the server has already spawned, delivered with `publishToOne`. Reuse the shape and the
  no-listener handling of `LAUNCH_TERMINAL_CHANNEL` (`common/launchAgent.ts:15`,
  `index.ts:688-700`) rather than inventing a second convention — but note the payloads differ
  (adopt an id vs. spawn at a cwd), so it is a sibling channel, not a widened one.
- **Grid side**: subscribe where `App.vue:58` already subscribes (NOT in `GridView`, which is
  `v-if`d on the route and does not exist until `/terminals` has been visited once — the same
  trap #831 hit), and adopt via the existing `sessionCell` + `insertCellAfter` path that
  `launchSkill` uses.
- **Reconciliation on load**: on `GridView` mount, ask the server for **programmatically spawned,
  visible, unplaced** sessions and add cells for them. Scope it to exactly that set — server-side,
  by a marker set at spawn time (the same place `runWithHiddenMarker` and
  `scheduledSessions.register` already sit), **not** by diffing "all sessions" against the grid
  state. A broad diff would sweep up ordinary sessions and change what a reload does to a normal
  cell, which the invariant forbids.
  Two more things to be careful of: a session already placed in another tab (duplicate cells
  across tabs are acceptable — cells are per-tab by design), and one the user deliberately closed
  (a closed cell must not resurrect on reload — clear the marker on close, so "unplaced" is
  server-side state with one writer rather than a growing dismissed-set in each tab).
- **Exclude hidden workers** — and add a spec that pins it (translation, hidden feeds refresh).
- **Cap policy** — implement whichever answer the owner picks above, and make it audible.
- Re-pointing `registerChatOpener` also removes the `hidden: true` workaround at
  `GridView.vue:496`, whose only purpose is stopping the single view from stealing the session.
- **`hidden` keeps its other meaning.** `hidden: true` in `background-chat.ts:14` marks a real
  background worker; the skill button's use of it is a workaround, not the same thing. Do not
  collapse the two while removing the workaround.

### PR4 — make the grid self-sufficient

Everything the single view currently owns has to exist in the grid *before* PR4.

- **Five full-screen overlays live inside the `!isGrid` block** (`App.vue:398-412`):
  `CollectionsBrowseOverlay`, `AccountingOverlay`, `WikiBrowseOverlay`, `PrsOverlay`,
  `FilesOverlay`, plus `AppSettingsModal`. Hoist them out of the branch so they render on
  `/terminals` too. The comment at `App.vue:39` warns about exactly this.
- `overlayOrigin.ts:34` falls back to `{ name: "chat" }` — must become `terminals`.
- `AppToolbar.vue:102` pushes `{ name: "chat" }` (the #941 view switch) — the switch goes away.
- The chat launcher and the 81-cell fallback are handled in PR3 above.
- `ToolsPane` is still single-view-only; `GuiPanel` already has a grid home (zoomed cell).
  Decide whether ToolsPane moves beside the zoomed cell or is dropped.
- The session list: `Sidebar` / `SessionTabBar` filter + selection has no grid equivalent
  beyond the cockpit roster. Confirm the roster covers it (it does show every cell) — and note
  it does NOT show off-grid sessions (`GridView.vue:102`).

### PR5 — delete the single view

Only after PR3 and PR4 land and the grid has been used for a few days.

- `App.vue`: the whole `v-if="!isGrid"` block, `isGrid`, `singleAgent`, `connectKey`,
  `terminalWidth` + splitter (`splitterWidth.ts`), `persist-key="single"`, the `"single"` half of
  `useUnloadGuard` (`App.vue:80-93`).
- Components with no other caller: `Sidebar.vue`, `SessionTabBar.vue`, possibly `ToolsPane.vue`.
- Router: drop `/chat`; `/` already redirects by NAME to `terminals` (`router/index.ts:20`) so the
  default view needs no change. Keep `/chat` as a redirect to `/terminals` for one release —
  people have it bookmarked.
- `hiddenMarker` / `background-chat` / translation workers are **not** single-view concepts and
  must keep working — they spawn headless, with no view at all. Pin that with a spec.

## What has to be true before PR5

- A grid cell at `{workspace}` can do everything the single view could: full GUI MCP, Canvas,
  every overlay, skill buttons, collection chats.
- Every visible programmatic spawn lands in the grid — including one made while no browser was
  open, which is the case the placement channel alone does not cover.
- No route, composable or plugin resolves `{ name: "chat" }`.
- `yarn typecheck`, `typecheck:server`, `typecheck:test`, `yarn test` — all four, per CLAUDE.md.
- Changelog entry + a dated `docs/guide/{en,ja}/v<version>.md`: two features are being REMOVED
  (single view, sandbox) and one env var family disappears. That page is what an upgrader who
  used `MULMOTERMINAL_SANDBOX=1` needs.
