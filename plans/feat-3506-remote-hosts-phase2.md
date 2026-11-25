# feat: remote hosts, phase 2 — status from the remote: dots, sound, cost (#3506)

Phase 2 of the umbrella #3506, on top of phase 1 (`plans/feat-3506-remote-hosts-phase1.md`). After
phase 1 a remote cell's terminal works. Everything else about the cell's state stays blank:

- the working / waiting dot stays idle;
- no attention sound plays;
- the token and context badge is empty;
- the cockpit roster has no title or prompt for the cell.

All of that comes from the Mac's own `sessions` pub/sub channel and the Mac's `/api/session/:id`,
and the remote's sessions are in neither. This phase brings the remote's status into the Mac's UI.
Files, git, drops and GUI tools remain phase 3.

## What exists today (the facts this plan rests on)

- **The `sessions` channel** (`server/session/lifecycle.ts`, `SESSIONS_CHANNEL`) carries three
  kinds of message, all keyed by bare session id:
  - the activity row `sessionRow()` (`server/session/activity/activity-transition.ts`):
    `{ id, cwd, working, waiting, event, lastPrompt, aiTitle, lastResponse, memo }`;
  - `{ id, event: "closed", failed }` on reap;
  - `{ id, event: "created" }` on spawn.
- **Seven client subscribers** read it, every one keyed by id alone:
  - `useGridActivity`, `useAttentionSound`, `useSessions`, `useFaviconState`;
  - `collectionChatSessions`, `useGithubBoardLive`;
  - `TerminalCell` (the dot, the missed ring, prompt/title/memo).

  Missed events are not replayed, so each one re-seeds over REST on reconnect (`GET /api/activity?ids=`,
  `GET /api/session/:id`, `GET /api/sessions`).
- **The attention sound is decided in the browser** (`notifyKindOf`, `src/composables/notifyKind.ts`).
  - It is decided from the previous and next row per id, then played with `/api/dir-sound?cwd=<row cwd>`.
  - It does not check what is viewed. Suppression happens on the server, which withholds
    `waiting: true` from the active pane.
- **The view-active report already reaches the remote.** `{ type: "view" }` and `{ type: "attention" }`
  travel on the cell's terminal WebSocket, which phase 1 pipes to the remote. The remote's own
  suppression is therefore already correct for remote cells.
- **The token and context badge** comes only from `GET /api/session/:id?agent=&cwd=` (`usage`,
  `context`), fetched at mount and on the working-to-idle edge. That route has a side effect: it may
  start a title regeneration.
- **The remote's pub/sub admits a loopback client with no Origin** (`allowed-origin.ts`: no origin
  plus a loopback peer is allowed). Over `ssh -L` the remote sees its own sshd, which is loopback.
  `socket.io-client` is already a runtime dependency.
- **Phase 1 refuses `/remote/<id>/ws/pubsub`** on purpose (`decideRemoteUpgrade`).

## Decisions

- **The Mac's server relays; the browser does not subscribe to the remote.**
  - The Mac opens one `socket.io-client` connection per configured, reachable, same-major host. It
    subscribes to `sessions` and to nothing else, and republishes each message on the Mac's own pub/sub.
  - The alternative was forwarding `/remote/<id>/ws/pubsub` through the gateway. That would let the
    page subscribe to any channel on the remote (`file-write`, `ask-question`, …), and phase 3 has
    not decided what may cross. A fixed channel in server code is the allowlist.
- **A separate channel, `remote-sessions`, not the existing `sessions`.**
  - Every current subscriber keys by bare id, and some act on the row's `cwd` against this machine
    (`useAttentionSound` asks `/api/dir-sound?cwd=`). Mixing remote rows into `sessions` would make all
    seven subscribers wrong at once, silently.
  - A new channel means each consumer opts in, and is reviewed when it does.
  - Payload: `{ host, row }`, where `row` is the remote's message copied field by field, never passed
    through. `host` is required.
- **Identity is `(host, id)`.** A pure `remoteSessionKey(host, id)` in `common/remoteHosts.ts` is the
  one key every client map uses for remote rows. Local rows keep their bare id, unchanged.
- **Resync is a message, not a guess.** When the relay connects or reconnects to a host, it publishes
  `{ host, resync: true }`. Clients then re-seed that host only. This mirrors how the local consumers
  re-seed on their own reconnect.
- **REST is forwarded on fixed Mac routes with field allowlists**, like `/api/remote-hosts/:id/dirs`
  in phase 1. There is no generic proxy:
  - `GET /api/remote-hosts/:id/activity?ids=` reads the remote's `/api/activity?ids=` and answers
    `{ working, waiting, event }` per id. This is the seed for dots.
  - `GET /api/remote-hosts/:id/session/:sid?agent=` reads the remote's `/api/session/:sid` and
    answers only:
    - `usage`, `context`, `workPhase`;
    - `lastPrompt`, `lastResponse`, `aiTitle`, `customTitle`, `agentTitle`, `memo`.

    The session id is validated before it is put into the remote URL.
  - Both use the existing timeout (`fetchWithin`). A failure answers 502 with the host and the URL.
- **The sound for a remote row uses the default sound, never the directory's.** The directory sound is
  looked up by path on this machine, and a remote path names nothing here. Asking the remote for its
  directory sound is phase 3 (files).
- **The roster's PR phase and directory chrome stay withheld.** Both are looked up by cwd on this
  machine (`/api/pr-phase`, `/api/dir-config`), so they belong with files and git in phase 3.
- **Web Push is untouched.** A remote with `pushEnabled` keeps pushing to the phone by itself, and the
  Mac does not push for remote rows. Two machines both pushing for the same session cannot happen,
  because a session lives on one of them.

## Server

- `server/backends/hostGateway/remoteSessionsRelay.ts`:
  - It holds one client per host, built from `loadRemoteHosts` plus the version check.
  - Reconnect is left to socket.io-client's own backoff. On every `connect` it publishes the resync
    message.
  - A host whose config entry disappears is disconnected when the config is next read. The read
    happens on a timer named as a constant, since `config.json` has no watcher here.
  - The `connect`/`subscribe` client is injectable, so the spec can drive a real socket.io server on
    loopback.
- Pure `relayMessage(host, data)` → `{ host, row } | null`. It copies the known fields of all three
  message kinds, drops anything malformed, and validates the id.
- The two REST routes go beside the phase 1 routes in `remoteHostsRoutes.ts`. The field allowlist is
  a pure function with its own spec.

## UI

- **Dot and missed ring** (`TerminalCell`):
  - A remote cell subscribes to `remote-sessions`, filters by `(host, id)` and applies the row through
    the same `applyActivityPush` a local push takes.
  - It seeds from the activity route at mount and on resync.
  - Prompt, title and memo then come along for free, because they are in the row.
- **Grid tally, sort and roster badge** (`useGridActivity` via `GridView`): remote cells join as
  `(host, id)` pairs from a second source. The local path stays byte for byte as it is.
- **Favicon** (`useFaviconState`): remote waiting / working counts toward the tab icon. The entries are
  dropped on `closed` and replaced on resync.
- **Attention sound** (`useAttentionSound`):
  - It subscribes to `remote-sessions` too. The previous-state map is keyed by `remoteSessionKey`.
  - `notifyKindOf` is reused unchanged. The sound is played with no cwd, so the default sound is used.
  - The missed mark is keyed the same way.
- **Token and context badge** (`TerminalCell.refreshUsage`): for a remote cell, it asks the forwarded
  detail route instead of returning null, on the same triggers a local cell uses.
- **Roster meta** (`GridView.refreshAllMeta`): remote cells are seeded through the forwarded detail
  route. The poll keeps its cadence, so each remote cell costs the remote what the remote's own roster
  would cost it.

## PRs (each can be reverted on its own)

1. The relay and the `remote-sessions` channel, plus the activity seed route. No UI change, so it is
   inert without a consumer.
2. Dots: `TerminalCell`, `useGridActivity`, favicon.
3. The attention sound for remote rows.
4. The token and context badge and the roster meta, through the detail route.

## Tests

- Pure:
  - `relayMessage` over the three message kinds and malformed input (missing id, wrong types, extra
    fields not copied);
  - `remoteSessionKey`;
  - the detail field allowlist;
  - `notifyKindOf` driven through remote keys, including a local and a remote session sharing an id.
- Relay: a real socket.io server on loopback as the "remote". The spec checks that:
  - a published row reaches the Mac channel tagged with the host;
  - only `sessions` is subscribed;
  - a reconnect publishes resync;
  - a host removed from config is disconnected.
- Routes: injected fetch, as in phase 1. An unknown host gets 404 without a fetch, and a failure 502.
  Fields outside the allowlist never come out, and an invalid session id is refused before any fetch.
- UI:
  - a remote cell's dot follows a `remote-sessions` push and ignores a local `sessions` push with the
    same id, and the reverse for a local cell;
  - the sound plays the default for a remote row and never asks `/api/dir-sound` with a remote path;
  - the tally counts remote cells;
  - the badge reads the forwarded route.
- Each change that claims "the local path is unchanged" (`useGridActivity`, `useAttentionSound`,
  `useFaviconState`) is proved by running the old and new code side by side over generated local
  rows, per `/refactor-safely`.

## Verification on the real stack

- Run two scratch servers, as in phase 1. The remote's agents are not logged in there, so drive real
  activity through the remote's own hook endpoint for a real remote session (the route the agent's
  hooks call). Then check:
  - `working`, then `Stop`, then an actionable `Notification`: the cell's dot follows each step;
  - the tally and the favicon count the cell;
  - the sound fires for `finished` and `waiting`, with no `/api/dir-sound` request naming a remote path;
  - zooming the remote cell suppresses `waiting` on the remote side, as it does locally;
  - stopping and restarting the remote makes the dots resync.
- Repeat over `ssh -L` to the Linux container from the phase 1 check.
- Name in each PR what was not exercised.

## Out of scope

- Directory sounds, PR phase and directory chrome for remote cells (phase 3).
- Files, git, drops and GUI tools (phase 3).
- The remote's `notifications` (bell) channel. Nothing there is per session today.
- Relay or reverse direction (phase 4).
