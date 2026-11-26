# feat: remote hosts, phase 1 — terminal cells from Linux servers in the Mac's grid (#3506)

Phase 1 of the umbrella #3506. The Mac's MulmoTerminal becomes a gateway: a cell can belong to a
remote MulmoTerminal reached over a user-run `ssh -L` tunnel, and it sits in the same grid as the
local cells. Only the terminal travels in this phase; status, files and git are phases 2 and 3.

## Decisions taken for this phase

These close the umbrella's checklist **for phase 1 only**; each can be revisited later.

- **Gateway, not direct.** The browser talks to the Mac's server alone, on its one origin. The Mac's
  server forwards to the remote. The existing origin checks stay as they are.
- **No new auth: loopback only.** A remote's `url` must be `http://` to a loopback address, i.e. the
  local end of an `ssh -L`. SSH is the authentication. A non-loopback URL is refused at config load
  with a reason, because nothing would stop anyone who can reach it from driving its terminals.
  Tokens are for when that restriction is lifted.
- **The gateway forwards no browser `Origin`.** The remote then sees a loopback peer with no Origin,
  which its own `allowed-origin.ts` already admits as a local non-browser client. Nothing changes on
  the remote side.
- **The user runs the tunnel.** MulmoTerminal does not start or supervise `ssh`. When the tunnel is
  down, the remote is reported unreachable.
- **Identity is `(host, session)`.** `Cell` gains `host?: string`, absent for local, following the
  absent-key convention `agent` and `parked` already use (`src/components/gridTabs.ts:47`).
  `parseGridState` carries it, so a reload re-attaches the remote cell.
- **Version check.** On first use the gateway reads the remote's `package.json` version (through
  `/api/update-status` or a small read added beside it) and refuses a different major version.
  The cell then says so instead of failing on a frame it cannot parse.

## Config

The global `~/.mulmoterminal/config.json` gains:

```json
{ "remoteHosts": [{ "id": "linux1", "label": "build box", "url": "http://127.0.0.1:34599" }] }
```

- The schema and its pure validator go in `common/remoteHosts.ts`, since both the server and the UI
  read it.
- `id` is limited to `[a-z0-9-]` so it can sit in a URL path segment unescaped. Duplicate ids, a bad
  URL and a non-loopback URL are each dropped with a reason, and the rest still load.
- It is loaded, saved and sent the way `app-config.ts` handles the other global keys. A Settings UI
  is out of scope; the `mulmoterminal-config` router and the owning skill learn the key.

## Server: the gateway

- **Path rule (pure):** `/remote/<id>/<rest>` maps to `{ id, rest }`, with an exact segment match
  and no prefix tolerance, for the reason `server/routes/terminal-ws-path.ts` gives.
- **WebSocket:** the upgrade handler (`server/routes/ws-routes.ts`, around `onUpgrade`) is extended.
  - A `/remote/<id>/…` path passes the Mac's own `isAllowedOrigin` first, exactly as a local
    terminal path does.
  - Its `rest` must be one of the terminal paths `terminalWsKind` knows. Anything else is refused,
    so `/remote/<id>/ws/pubsub` is not tunnelled in phase 1.
  - The upgrade is then replayed to the remote and the two sockets are piped. This is a byte pipe,
    not a parse-and-resend, so the frame format stays the remote's business.
  - The handler runs only for paths that start with `/remote/`, so socket.io's own upgrade on
    `/ws/pubsub` is untouched.
- **HTTP:** `/remote/<id>/api/*` is proxied for an **allowlist** of read-only routes that a remote
  cell needs in this phase, and only those. Likely candidates are the remote's directory presets
  for the launch form and its session list for resuming. The allowlist is fixed during
  implementation from what the launch form actually reads. POSTs and everything else are refused.
- **Reachability:** `GET /api/remote-hosts` returns each configured host with
  `reachable | unreachable | version-mismatch`, probed with an `AbortController` timeout.

## UI

- **Endpoint:** `connWsUrl` (`src/components/wsUrl.ts:186`) takes the cell's host and prefixes
  `/remote/<id>`. It stays a pure function, so the spec covers every endpoint kind with and without
  a host.
- **Launch:** the launch panel gets a host picker, shown only when `remoteHosts` is non-empty. For a
  remote host, the directory comes from the remote's presets, through the allowlisted proxy, or is
  typed in.
- **Header:** a remote cell's header shows the host label, as the account label is shown today.
- **Disconnects:** the existing reconnect loop applies. A remote that is unreachable shows
  "disconnected", with the tunnel hint from `bin/ssh-hint.js` as the reason.

## The invariant that matters most: a remote cell never reaches a local API with its own data

Everything a cell does besides its terminal (file links, drops, the Files pane, the Run menu, git
status, worktrees, GUI MCP tool output, transcript/handoff) calls the **Mac's** `/api/*` with the
cell's cwd. For a remote cell that cwd names a path on the Linux box, and the call would act on, or
read, the Mac's file of the same name.

- So in phase 1 each of those actions is **withheld** for a cell with `host`. This works like the
  `remoteServer` flag withholds screen actions (`plans/feat-2669-remote-server-flag.md`): hidden
  where the action is offered, and declined at the one call it goes through.
- One predicate, `isRemoteCell`, decides it. A spec enumerates the cell actions and pins each one,
  so a new action added later must be classified.
- Phases 2 and 3 re-enable them one by one, routed to the remote.

## Tests

- Pure specs:
  - the `remoteHosts` validator, normal and abnormal: empty, duplicate id, bad charset, `https`,
    non-loopback, IPv6 loopback, missing fields, wrong types;
  - the `/remote/<id>/<rest>` path rule;
  - `connWsUrl` with a host;
  - `parseGridState` round-tripping `host`;
  - the `isRemoteCell` action table.
- Gateway spec: a stub remote HTTP/WS server on loopback. It checks that:
  - frames pass both ways;
  - no `Origin` header reaches the remote;
  - a foreign origin on the Mac side is refused;
  - a non-allowlisted API path is refused;
  - an unreachable remote and a version mismatch are reported.

## Verification on the real stack (wide blast radius: the upgrade handler)

- **Two local servers:** run a second MulmoTerminal as the "remote", with a scratch `HOME` (it gets
  its own `-L mulmoterminal-<hash>` tmux socket, per CLAUDE.md) on another port. Configure it as a
  remote host and check that:
  - a Shell and a Claude cell start on it, type, and survive a page reload and a remote restart;
  - local cells and `/ws/pubsub` (activity dots) keep working beside them.
- **Real SSH:** use the Linux container from #2669 (sshd, `mulmoterminal@latest`) behind `ssh -L`.
  Run `uname` in a remote cell, then drop the tunnel and reopen it.
- **Name what was not exercised** in the PR.

## Out of scope (later phases)

- Status dots, sound and cost from the remote (phase 2).
- Files, git, drops and GUI tools routed to the remote (phase 3).
- Relay or reverse direction (phase 4).
- Tokens or TLS for non-loopback remotes.
- A Settings UI for `remoteHosts`.
- MulmoTerminal starting `ssh` itself.
