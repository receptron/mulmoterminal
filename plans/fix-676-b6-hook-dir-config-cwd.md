# fix #676 B6 — dir-config live-reload resolves relative paths against the wrong cwd

Part of #676 (棚卸し 第3弾, priority B, item B6). Behavior change approved by the user:
`body.cwd` takes precedence over the spawn-time PTY cwd.

## Problem

`server/routes/hook-routes.ts` resolves the dir-config live-reload target two different ways
depending on the hook path:

- `handleHookRequest` (the header/title path) uses
  `typeof body.cwd === "string" ? body.cwd : entry?.cwd` — the CLI-reported live cwd wins.
- `handleToolHook` (the `.mulmoterminal.json` live-reload path, line ~71) uses only
  `ptys.get(sessionId)?.cwd ?? null` — the directory the PTY was **spawned** in.

The PTY entry's `cwd` is the spawn dir; it goes stale the moment the session `cd`s. So a
session that has changed directory and writes `.mulmoterminal.json` with a **relative**
`file_path` publishes a reload notification for the *wrong* directory (the spawn dir), while
missing the directory that actually changed. Low probability, but the two hook paths disagree
on a decision that should be identical.

## Fix

Resolve the hook cwd **once** and share it across both hook paths.

1. Extract the resolution into a pure, testable function
   `resolveHookCwd(bodyCwd, spawnCwd)` in `server/session/activity-hook.ts` (next to the
   sibling `resolveHookSessionId`). It returns `typeof bodyCwd === "string" ? bodyCwd : spawnCwd`
   — exactly what `handleHookRequest` already computed inline.
2. `handleHookRequest` calls `resolveHookCwd(body.cwd, entry?.cwd)` and passes the result to
   `handleToolHook`, which stops reaching into `ptys` for its own cwd and uses the shared value
   when calling `dirConfigWriteTarget`.

This eliminates the divergence entirely: there is one cwd, resolved one way, for the whole
request.

## Tests (test/server/session/activity-hook.spec.ts)

Pin the decision the route delegates:

- `resolveHookCwd` prefers `body.cwd` over the spawn cwd (the regression this fixes).
- Falls back to the spawn cwd when `body.cwd` is absent / not a string.
- Returns `undefined` when neither is present.
- End-to-end with `dirConfigWriteTarget`: a relative `.mulmoterminal.json` write resolves under
  `body.cwd`, not the spawn cwd.

## Mutation check

Revert `resolveHookCwd` to ignore `body.cwd` (return the spawn cwd) and confirm the new
"prefers body.cwd" tests go red, then restore.
