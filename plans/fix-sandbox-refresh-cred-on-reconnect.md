# fix: re-sync the sandbox credential from the Keychain on reconnect

## Motivation

A sandbox (single-view Docker) session's Claude credential is snapshotted at spawn onto a
**read-only** mount (#211). Claude Code rotates its OAuth token over time; a long-running
sandbox therefore drifts stale and eventually shows **"Not logged in"**, currently
requiring a full re-spawn (restart server + fresh session).

## Why not just make the mount writable

Verified with node-pty: a **read-write bind-mounted file** allows in-place writes but
**rejects atomic rename** ("Permission denied") — and Claude persists a refreshed token via
atomic rename, so a RW file overlay wouldn't let it self-refresh. (Atomic rename works only
inside a directory mount.) So the minimal, low-risk fix is to re-sync the mounted credential
whenever the user reconnects.

## Fix (`server/index.ts`)

On reattach to a **sandbox** session, call `writeSandboxCredentials(sessionId)` again — it
overwrites the mounted per-session creds file in place from the current Keychain, so a token
that rotated since spawn is picked up on the next reconnect.

```ts
if (live?.sandbox) writeSandboxCredentials(sessionId);
entry = live ? reattachPty(...) : spawnClaudePty(...);
```

## Scope / limitation

This is a **preventive** refresh on reconnect: reconnecting re-syncs the credential. A
session already stuck at "Not logged in" (Claude at the login screen doesn't re-poll the
file) still needs a fresh session; a long-idle session that's never reconnected also won't
refresh until the next reconnect. A fuller self-refresh would require moving the credential
into the RW `~/.claude` dir mount (mutating the host file) — deferred.

## Verification

- `format`/`lint`/`typecheck`/`typecheck:server`/`build`/`test` green.
- Mount-write behavior verified with node-pty (file rename fails; dir rename works),
  informing why reconnect-refresh (not a RW overlay) is the chosen approach.
