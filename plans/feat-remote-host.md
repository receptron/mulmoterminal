# feat: bring the remote-host capability into MulmoTerminal

## Goal

Let a **mobile remote** (a phone browser — the `mulmoserver` app at
`https://mulmoserver.web.app`) drive **MulmoTerminal** the same way it already
drives MulmoClaude: list collections, render mobile custom views, edit records,
and start a chat — over a **Firestore-backed request/response channel**, with no
Cloud Functions, no polling, and no inbound network exposure of the terminal.

MulmoTerminal becomes a **host**: it signs in to Firebase *as the user*, listens
to that user's command queue in Firestore under its own host id, runs a handler,
and writes the result back. The phone reads the result via a real-time listener.

This is the **consume** half of a two-repo effort. The generic transport — the
command channel, the host runner (command loop), the Firebase auth/session
lifecycle — is being **extracted into `@mulmoclaude/core`** on the MulmoClaude
side (their plan: `plans/feat-remote-host-core-extraction.md`; published as a new
`@mulmoclaude/core` minor). MulmoTerminal then adds only its **own handlers**,
its **Connect/Disconnect UI**, and one **connect route** — it does not re-copy
the transport. This mirrors how MulmoTerminal already consumes the collection /
notifier / scheduler / feeds engines from core (`feat-shared-backend-services.md`).

> ⚠️ **Blocked on the MulmoClaude core extraction shipping + publishing first.**
> Like the feed-refresh PR (4b) in `feat-shared-backend-services.md`, this cannot
> be built or verified from a MulmoTerminal branch until the new
> `@mulmoclaude/core` is on npm. Sequence: MulmoClaude PR 1 (extract) → publish →
> MulmoTerminal PR (this plan).

## What core will provide (after the extraction)

Two new subpaths on `@mulmoclaude/core`, split by the browser-safe boundary
(mirrors the existing `@mulmoclaude/core/remote-view`):

| Import (subpath of `@mulmoclaude/core`) | Surface | Role |
|---|---|---|
| `@mulmoclaude/core/remote-host` | **browser-safe** | Protocol types (`Command`, `CommandStatus`, `Channel`, `CommandHandlers`), Firestore path helpers `commandsCollection(firestore, channel)` / `hostDoc(firestore, channel)`. Shared by host **and** the phone client. |
| `@mulmoclaude/core/remote-host/server` | **server-only** | `startHostRunner(firestore, channel, handlers, opts)` — the command loop (heartbeat presence, `runTransaction` claim, write-back); `createRemoteHost(deps)` — the connect/disconnect/status lifecycle factory; Firebase auth helpers (`signInHost`/`signOutHost`/`currentUid`) + a `createRemoteHostFirebase(config)` init. |

The already-published `@mulmoclaude/core/remote-view` (present in core ≥0.8.0,
MulmoTerminal is on `^0.8.2`) supplies the mobile custom-view contract
(`buildRemoteViewSrcdoc`, CSP, `clampOffset`/`clampLimit`, `projectItems`,
`handleRemoteViewMessage`, `REMOTE_VIEW_MAX_BYTES`) — no change needed there.

## MulmoTerminal integration seams

Re-grep before editing (`main` moves fast), but confirmed from the current repo:

- **Package**: single package (no `packages/` monorepo). Consumes core from npm →
  **blocked until the new core publishes** (same as feed-refresh).
- **`firebase` dep — MISSING.** MulmoTerminal has no `firebase` and no
  `@mulmobridge/*`. Add `firebase` (web SDK) — used in the browser
  (`signInWithPopup`, extract `idToken`) and in Node (`signInWithCredential`,
  `onSnapshot`). Match the version MulmoClaude ships.
- **Collection engine — PRESENT, core-backed.** `server/backends/collections.ts`
  already calls `configureCollectionHost` + imports `discoverCollections`,
  `toSummary`, `toDetail`, `loadCollection`, `listItems` from
  `@mulmoclaude/core/collection/server`. The read handlers reuse these verbatim.
- **Feeds — PRESENT.** `server/backends/feeds.ts` (`@mulmoclaude/core/feeds/server`)
  backs `listFeeds`/`getFeed`.
- **Shortcuts / skills / accounting — PRESENT.** `server/backends/shortcuts.ts`;
  skills wiring in `server/index.ts`; `@mulmoclaude/accounting-plugin@^0.3.2`
  (`/server`) for `listAccountingBooks`.
- **Chat spawn — PRESENT, differently named.** No `spawnSystemWorker`. Use
  `spawnClaudePty(sessionId, resume, ws, initialPrompt?, cwd?, ...)`
  (`server/index.ts`) — the same primitive behind
  `POST /api/plugin/spawnBackgroundChat` and `spawnScheduledChat`. The remote
  `startChat` handler wraps a visible `spawnClaudePty` seeded with `message`.
- **Toolbar — PRESENT (Vue).** `src/components/AppToolbar.vue` (shared by
  `App.vue` + `GridView.vue`); the `.launcher` nav of `material-symbols-outlined`
  buttons. Dark palette: bg `#16213e`, text `#e6e6f0`, muted `#9aa6cc`, hover
  `#26375f`, active `#2f59c0`. The Connect/Disconnect control mounts here.
- **Route mount — `mountXRoutes(app, deps)`** convention, registered imperatively
  in `server/index.ts`. Routes are guarded by `isAllowedOrigin` (there is **no
  global bearer auth** — MulmoTerminal is a loopback tool). The connect route
  follows the same guard.
- **Workspace root** — `CLAUDE_CWD` (`server/index.ts`).

### Infra shims MulmoTerminal lacks (all small, additive)

- **`server/utils/time.ts` (`ONE_MINUTE_MS`) — MISSING.** Only ad-hoc consts
  (e.g. `ONE_HOUR_MS` inline in `viewToken.ts`). The heartbeat interval is passed
  into `startHostRunner` (core takes it as a param), so a single local const
  suffices — no shared module required.
- **Central logger — MISSING.** Per-file `[scope]`-prefixed `console` wrappers
  (as in `server/backends/collections.ts`). The remote-host binding defines its
  own `[remote-host]` logger the same way.
- **`src/config/apiRoutes.ts` — MISSING.** URLs are inlined in `fetch` calls.
  The Connect control inlines `/api/remote-host/connect` etc. to match local
  convention (do **not** introduce a constants module just for this).

### Genuinely missing subsystem — workspace attachments

`saveAttachment` / an attachment store / a thumbnail store **do not exist** —
images in MulmoTerminal are ephemeral base64 (`image-gen.ts`, `markdown.ts` note
"no image store / serving"). This blocks two things:

- `ingestAttachments` (remote chat **image attachments** staged via Firebase Storage).
- the **image-thumbnail** inlining in `getRemoteViewItems` (record image fields → `data:` thumbs).

**Decision: defer both to a later phase** (phase 3 below). Ship text + views
first; building the attachment/thumbnail store is a separate, larger effort with
no existing MulmoTerminal equivalent to lean on (only `parseDataUrl` in
`whisper.ts` to crib from).

## Decisions

1. **`hostId = "mulmoterminal"`.** MulmoClaude hardcodes `"mulmoclaude"`. If both
   apps run under the same Google account they must NOT share a command queue, so
   MulmoTerminal takes its own id. The channel is `users/{uid}/hosts/mulmoterminal/commands`.
2. **Same Firebase project (`mulmoserver`).** Reuse the shared public project so
   the one phone client reaches either host. The public web config can be a local
   `src/config/firebaseConfig.ts` (mirror MulmoClaude) or imported from core if the
   extraction exports it.
3. **Cross-repo coordination (out of scope here, but tracked).** The phone client
   (`../mulmoserver`, external) must be taught to target `hostId="mulmoterminal"`
   (a host picker, or a second entry). Nothing in this PR is phone-reachable until
   that lands — same "everything except the mulmoserver client" caveat every
   MulmoClaude phase carried.
4. **Reuse the scoped view-token infra where relevant.** `server/backends/viewToken.ts`
   already mints/enforces per-process scoped tokens for custom views; the remote
   view handlers run in-process and bypass HTTP tokens (same as MulmoClaude), so
   no token work is needed for the channel path.

## Implementation plan

### Phase 1 — transport + read-only capabilities + connect UI (one PR)

The load-bearing PR. No new subsystems; everything leans on already-wired core
engines.

**Deps**
- Add `firebase` (web SDK, match MulmoClaude's version).
- Bump `@mulmoclaude/core` to the version that first exports `remote-host`(+`/server`).
- `yarn install` (branch switches prune the shared `node_modules`).

**Server (`server/backends/remoteHost/`)** — thin host binding, `mountXRoutes` style:
- `firebase.ts` — `createRemoteHostFirebase(firebaseConfig)` from core → `{ firestore, auth }`.
- `handlers.ts` — the MulmoTerminal handler table, each reusing existing backends:
  - `listCollections` → `discoverCollections().map(toSummary)` (via `collections.ts`).
  - `getCollection` → `loadCollection` + `toDetail` + a page of `listItems`.
  - `getRemoteView` → build the `target:"mobile"` srcdoc with
    `@mulmoclaude/core/remote-view` (`buildRemoteViewSrcdoc`) over the collection's
    custom-view HTML; enforce `REMOTE_VIEW_MAX_BYTES`.
  - `getRemoteViewItems` → a `fields`-projected page (`projectItems`/`clamp*`),
    **image fields omitted for now** (no thumbnail store — phase 3).
  - `mutateRemoteViewItem` → `writeItem`/`deleteItem` with the view's
    `editableFields`/`allowDelete` policy enforced **host-side**.
  - `listFeeds`/`getFeed` (`feeds.ts`), `listShortcuts` (`shortcuts.ts`),
    `listSkills`, `listAccountingBooks` (`accounting-plugin/server`).
- `index.ts` — `createRemoteHost({ signIn, signOut, currentUid, startRunner, handlers })`
  from core, with `hostId="mulmoterminal"`; expose `connect`/`disconnect`/`status`.
  Define a local `[remote-host]` console logger + a local `ONE_MINUTE_MS` for the
  heartbeat.
- `routes.ts` — `mountRemoteHostRoutes(app, { remoteHost, isAllowedOrigin })`:
  `POST /api/remote-host/connect {idToken}`, `POST .../disconnect`, `GET .../status`.
  Guard with `isAllowedOrigin`; **never log the idToken**.
- Register `mountRemoteHostRoutes` in `server/index.ts`'s mount block.

**`startChat` handler** (fold into phase 1 — text only):
- Seed a **visible** `spawnClaudePty` with the phone's `message`; resolve optional
  `role` via MulmoTerminal's role wiring (`server/host-tools.ts`); return
  `{ started, chatId }`. **No `attachments`** yet (phase 3).

**Frontend**
- `src/config/firebase.ts` + `firebaseConfig.ts` — browser web SDK init (project
  `mulmoserver`), mirroring MulmoClaude.
- `src/components/RemoteHostControl.vue` — a `material-symbols-outlined` toolbar
  button (e.g. `phonelink`, active-coloured when connected) + a small popover:
  online/offline, uid, Connect/Disconnect. Connect runs `signInWithPopup(GoogleAuthProvider)`,
  extracts `idToken`, POSTs `/api/remote-host/connect` (inlined URL). Match the
  dark toolbar palette; **no emoji** (Material Symbols only). Help text links
  `https://mulmoserver.web.app`.
- Mount `<RemoteHostControl />` in `AppToolbar.vue`'s `.launcher`.

**Tests** (vitest): handler-table shape; a `listCollections` unit test with the
engine stubbed → `{ collections }`; the connect route exposes connect/disconnect/status.

### Phase 2 — hardening / parity (optional, small)

- Presence/heartbeat liveness parity; reconnect-on-listener-death (`onClosed`)
  already handled by core's `createRemoteHost` — just wire the log.
- Feed-collection mobile views if MulmoTerminal grows a feed view surface
  (MulmoClaude left this out of scope too).

### Phase 3 — attachments + image thumbnails (separate, larger PR)

Only when wanted. Requires **building** in MulmoTerminal:
- a `saveAttachment` workspace helper + a served attachments dir,
- a thumbnail store,
then enabling `ingestAttachments` (Firebase Storage staging → workspace, delete
staged object, path-only `Attachment[]`) and the image-field thumbnails in
`getRemoteViewItems`. Storage staging + orphan-rollback semantics follow
MulmoClaude's `feat-remote-chat-image-attachments.md`.

## Out of scope

- The **mulmoserver phone client** changes (host picker for `"mulmoterminal"`) —
  external repo.
- Multi-account / multiple host ids per install; host-side concurrency limits.
- Attachments + image thumbnails until phase 3.

## Verification (every PR)

`yarn typecheck` (vue-tsc -b), `yarn lint` (bans the `void` operator via
`sonarjs/void-use`; enforces `id-length ≥ 3` except `_ i j ok`;
`security/detect-unsafe-regex`; `import/no-duplicates`; `no-shadow` — it `--fix`es
prettier), `yarn test` (vitest), `yarn build` (must bundle), plus a manual smoke:
connect from the toolbar → the presence doc `users/{uid}/hosts/mulmoterminal`
flips `online:true` and heartbeats; a `listCollections` round-trip from the
mulmoserver client (or the extraction spike listener) returns this terminal's
collections. CI gates: `lint-and-build`, `package-smoke`, `codex-review`.

## Sequencing notes

- **Do not start until `@mulmoclaude/core` with `remote-host`(+`/server`) is on
  npm.** Bump the dep, `yarn install`, then build phase 1.
- Bumping `@mulmoclaude/core` ripples to the shared workspace data model; keep
  MulmoTerminal's bump close to MulmoClaude's publish to avoid version skew
  (shared-workspace cross-app bug).
- Branch off current `main`; keep the PR focused on phase 1.
