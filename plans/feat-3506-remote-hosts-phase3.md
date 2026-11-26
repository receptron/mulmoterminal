# feat: remote hosts, phase 3 — files, git, drops and GUI tools on a remote cell (#3506)

Phase 3 of the umbrella #3506, on top of phases 1 and 2 (`plans/feat-3506-remote-hosts-phase1.md`,
`plans/feat-3506-remote-hosts-phase2.md`). A remote cell's terminal, status, sound and badges work.
Everything else a cell does is still **withheld**: the Files pane, git, the work item, header buttons
and menus, drops and paste, the memo, restart, handoff, and the canvas and tools panes. Phase 3 routes
them to the remote, one group at a time, and declines the few that are this machine's by nature.

This is the phase where **writes** cross the gateway, and that changes what the gateway is.

## What exists today (the facts this plan rests on)

- **The gateway forwards with no Origin**, and the remote admits a loopback peer with no Origin as a
  trusted local client (`allowed-origin.ts`). There is no token anywhere. So a forwarded request can do
  on the remote whatever the remote's own UI can, and more:
  - read and write any file (the browse routes take any absolute `cwd` as their base);
  - run commands: `/ws`, `/ws/run`, `/ws/launch`, typing into a PTY, `POST /api/config`, `/api/hook`,
    `/api/mcp/:sid`;
  - destructive actions: worktree remove and push, `/api/processes/kill`, `/api/shutdown`.

  Today only the gateway's fixed allowlist stops this. **Every route phase 3 opens is a decision about
  that power**, not plumbing.
- **The four file surfaces** (`docs/file-surfaces.md`): how far a surface reaches is set by who chose
  the path. The right pane is rooted at the cell's directory, `/files?cwd=` at the query string, watched
  documents at the workspace plus live session directories, and `presentDocument` at nothing. GET
  routes that serve bytes (`/api/files/raw`, `/api/files/page`) are held to the workspace and live
  session directories, because a GET has no Origin to judge. Anything else goes through a one-file grant.
- **Rendered documents and cards embed absolute URLs** (`/api/files/raw?cwd=…`, `/api/files/mermaid/…`,
  `/artifacts/html/…`). Served under the Mac's origin, those resolve against the Mac unless rewritten.
  Their CSP and sandbox must survive the proxy: an unsandboxed remote page under the Mac's origin would
  be same-origin with the Mac's whole API.
- **GUI MCP output never leaves the remote.**
  - A remote agent's tools post to the remote's own `/api/mcp/<sid>`.
  - Results are stored on the remote and published on `session:<id>` on the remote's pub/sub.
  - So are `toolcalls:<id>`, `ask-question`, `pane-command`, `prompt-submitted`, `file-write` and
    `tool-groups`.
- **Subscribing has side effects.** Joining `plugin:*:file:<path>` starts a file watch on the server.
  A relay must never subscribe to a channel name the page chose.
- **`/ws/run` and `/ws/launch` are already forwarded kinds.** What they run is decided by the remote's
  own config (`buttonId`, `index`). Header shell buttons and Run scripts therefore need only a command
  cell that carries `remoteHost`.
- **Some features are this machine's by nature:**
  - OS actions: `/api/files/open`, `/api/files/reveal`, `/api/open-dir`, `/api/pick-file`;
  - accounts and `switch-token`;
  - `cwd-presets`;
  - the stories roots from this machine's config;
  - voice, which already works: the text is typed over the forwarded socket.

## Phase 1 left leaks; they are fixed first

A remote cell's directory or session still reaches this machine's server in these places, found by the
phase 3 survey:

- **`CellPathMenu` is given `cwd`, not `localCwd`.** `git-remote` runs on mount, and Reveal, Pick,
  New terminal here and Directory settings act on this machine with the remote path.
- **`CopyCodeBlock` is given the session id and cwd**, so the button shows and calls `last-turn` locally.
- **The send button calls `relayHere` directly**, bypassing `cellActionAllowed`.
- **`useRelayButton` asks `GET /api/worktrees?cwd=<remote path>`** whenever another cell is in a
  different directory.
- **The keyboard path for `terminal-new-here` and `terminal-new-adjacent` in `GridView` is not
  guarded.** New-adjacent makes a local shell at the remote path.

These are phase 1 defects, so they get their own PR before anything here.
`TerminalCellRemote.spec.ts` grows to cover each one: the existing "no request names the cell's
session or cwd" property, with the path menu, the copy button, the send button and the keyboard path
exercised.

## Decisions

- **One declarative route table decides what crosses.** It lives in `common/remoteRoutes.ts` as a
  `Record` over every forwarded route, with its method, what keys it (session, cwd or nothing), and
  whether it is a read or a write.
  - The gateway forwards exactly those, and anything else under `/remote/<id>/api/` answers 404.
  - The table is reviewed as one diff. A census spec enumerates the server's `/api/*` routes and fails
    on a route that is neither in the table nor in an explicit "never forwarded" list with a reason
    (`/api/shutdown`, `/api/config`, `/api/hook`, `/api/mcp/*`, `/api/processes/kill`,
    `/api/terminal/:id/reply`, the custom-agent writes, …). A new server route then has to be
    classified, as `ON_REMOTE_CELL` makes a new cell action.
- **The browser calls `/remote/<id>/api/…`, under the Mac's origin.** The Mac's own guards (host guard,
  same-origin guard on writes) run first, exactly as for a local `/api/*` call. Then the gateway
  replays the request to the remote.
- **The forwarded request carries the remote's own origin, not none.** The Mac's page then has the
  power of the remote's own UI page, no more. A route that someday distinguishes "a local tool" from
  "a browser" keeps meaning the right thing for forwarded traffic. Phase 1's terminal upgrade keeps
  dropping the Origin; this rule is for the HTTP routes phase 3 adds.
- **cwd-keyed routes are pinned to the cell's directory by the gateway.** The browser sends the cell's
  directory. Only the Files pane's own browse routes may go below it, and never above it: the gateway
  rejects a `cwd` or `path` that leaves the directory the request names as its root. That is the right
  pane's rule, enforced where the remote cannot see which cell asked.
  - The full-screen `/files?cwd=` view is **not** offered for a remote host in this phase: its reach is
    whatever the query string says, which is more than a cell implies.
- **Session-keyed routes take only a validated session id** (`SESSION_ID_RE`), and the remote resolves
  that session's directory itself.
- **Pub/sub stays a fixed list.**
  - The relay gains per-session channels (`session:<id>`, `toolcalls:<id>`) subscribed on demand, when
    a remote cell asks for its own session; the channel name is built by the server from a validated
    id.
  - It also gains fixed shared channels: `ask-question`, `pane-command`, `prompt-submitted`,
    `tool-groups`, `dir-config`.
  - `plugin:*:file:*` is never relayed.
  - Each relayed message is wrapped `{ host, … }` on a Mac-side channel of its own, as phase 2 does for
    `sessions`.
- **Rendered documents and card resources go through one byte proxy, last.** It is a namespaced
  `/remote/<id>/bytes/…` that rewrites the absolute URLs it knows, and passes through the remote's CSP
  and sandbox headers unchanged; a response without them is refused. This is the riskiest piece. It
  closes the phase, and it is left out rather than rushed if the CSP cannot be shown to survive.
- **OS actions are declined for a remote cell** with the existing `remoteServer` decline pattern
  (#2669): `open`, `reveal`, `open-dir`, `pick-file`. Insert-path offers a path typed or picked from the
  remote's Files pane instead.
- **A drop on a remote cell always uploads.** A dropped Mac path names nothing on the remote.

## PRs (each can be reverted on its own)

0. **Close phase 1's leaks** (above). No new capability.
1. **The forwarding framework.** The route table, `/remote/<id>/api/*`, the origin rule, the cwd pin,
   and the census spec. The table starts with the read-only cwd routes, so the framework has a real
   consumer to test against.
2. **Read-only directory features.**
   - The git chip (`/api/git-status`), the work item's PR phase (`/api/pr-phase`), directory chrome
     (`/api/dir-config`, `/api/dir-icon`), the header buttons' display (`/api/header`), the Run, Skill
     and Mulmo menus (`/api/scripts`, `/api/skills`, `/api/mulmo/decks`), and directory sounds
     (`/api/dir-sound`).
   - Command cells gain `remoteHost`, so a header shell button or a Run script opens on
     `/remote/<id>/ws/run`.
3. **Session reads.** The prompts and transcript panes, the timeline, copy-code, and handoff "send"
   from a remote cell (`/api/transcript/*`, the `prompt-submitted` relay).
4. **Small writes.**
   - The memo (`POST /api/session/:id/memo`).
   - Drop and image paste (`POST /api/session/:id/drop`, always upload).
   - `relay-mark`.
   - Restart, which is terminate plus reconnect; `switch-token` stays declined.
5. **The Files pane**, rooted at the cell's directory: the browse reads, then the writes (`write`,
   `create`, `rename`, `trash`, `backup`), and terminal file links for a remote cell.
6. **Worktree and GitHub actions.** The diff badge, push and PR, removal on close, and
   `POST /api/work-comment`.
7. **Canvas and tools.**
   - The per-session channel relay and the replay GETs (`/api/agent/toolResults/:id`, `/api/tools`,
     `/api/tool-calls/:id`, `/api/question/:id`, `/api/pane/check/:id`), plus `persistOnly`.
   - AskUserQuestion answers, which write to the remote PTY.
   - The byte proxy for card resources and rendered documents.
8. **The remote launch form catches up:** the worktree list and create, and the resume lists
   (`AGENT_SESSION_LIST_PATHS`).

Collections and talk are left for after this plan: collections bring a second store and their own
actions, and talk needs handoff in both directions.

## Tests

- **The census:** every server `/api/*` route is either in the forward table or in the "never
  forwarded" list. Adding a route without classifying it fails.
- **The gateway:**
  - only table routes are forwarded, with their method;
  - the Mac's same-origin guard rejects a foreign-origin write before any fetch;
  - the forwarded request carries the remote's origin;
  - a `cwd` or `path` escaping its root is rejected, lexically and through `..`, without a fetch;
  - a session id failing `SESSION_ID_RE` is rejected;
  - a remote failure answers 502 with host and URL.
- **The relay:** per-session channels are built only from a validated id, `plugin:*:file:*` is never
  subscribed, and each relayed channel lands on its own Mac-side channel tagged with the host.
- **The byte proxy:** a response missing CSP or sandbox headers is refused, and the known absolute URLs
  are rewritten into the host's namespace.
- **The UI**, per feature: the remote cell reaches the remote and never this machine with its own data
  (the property from phase 1, extended), and a local cell is unchanged.
- Each change that claims the local path is unchanged is run old-beside-new over generated inputs, per
  `/refactor-safely`.

## Verification on the real stack

- **Scratch gateway and remote, as in phases 1 and 2.** For each PR, drive the feature on a remote cell
  and on a local cell side by side. Check the remote's own files, git and tool results against what
  the Mac shows, with the remote's disk as ground truth.
- **Security checks on the running gateway, not only in specs:**
  - a foreign-origin write;
  - a route outside the table;
  - a `cwd` escaping the cell's directory;
  - a `plugin:*:file:*` subscription attempt.

  Each must be refused, and the remote's log must show that nothing reached it.
- **The Linux container over `ssh -L`**, as in the phase 1 check, for the Files pane and a drop.
- Name in each PR what was not exercised.

## Out of scope

- Collections and talk (after this plan).
- The full-screen `/files` view for a remote host.
- Tokens or TLS between the Mac and a remote, and non-loopback remotes.
- **The inherited exposure of the tunnel port** to other local pages. The remote admits
  `Origin: http://localhost:*`, so a page served from localhost on the Mac, or another local user, can
  reach the `ssh -L` port directly. That predates this plan and is not widened by it, but it is the
  reason a per-remote token is the next security step once this plan lands.
- Relay or reverse direction (phase 4).
