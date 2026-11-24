# jinglescript 1.5: render files under the session's working directory (#3435)

## Change

| Package | Before | After |
| --- | --- | --- |
| `jinglescript` | ^1.2.1 | ^1.5.1 |
| `@gui-chat-plugin/jinglescript` | ^1.2.1 | ^1.5.1 |

mulmocast's `jinglescript@^1.0.2` is deduplicated onto the same 1.5.1, so the lockfile keeps one copy.

## What 1.5 asks of the host

Through `files.byPath` the plugin now WRITES, with relative paths it also tells the model:

- `renderScore`: `jinglescript/<stem>.mp3` (`.wav` without ffmpeg) and `jinglescript/<stem>.timing.json`,
  after `exists` checks on `<stem>.mp3|.wav|.timing.json|.json` to pick a free stem.
- `composeScore`: `jinglescript/<name>.json` and `jinglescript/<name>.abc`, only when none of the names exist.

`jingleScriptByPath` (core `createByPathFileOps`, `.json` only, never creates) refuses all of it:
`invalid path: jinglescript/opening.mp3`.

## Decision (user)

The files live under the CALLING SESSION's directory: `<session cwd>/jinglescript/<name>`; the workspace when
the call names no session.

## Design

- `server/backends/files/jinglescriptFilePath.ts` (pure): `jingleScriptFileTarget(value, cwd)` answers
  - `{ area: "render", name }` for exactly `jinglescript/<name>` where `<name>` is one plain segment
    (no leading dot, no separator) ending `.json` / `.abc` / `.mp3` / `.wav`;
  - `{ area: "score", value }` for any other `.json` path, made absolute against `cwd` when relative — the rule
    `presentPathRoot.ts` applied to this tool until now (`artifacts/…` and absolute values untouched), shared
    through `sessionRelativePath.ts` rather than copied;
  - `null` for everything else (empty, non-string, wrong extension, `..`, nested render paths).
- `server/backends/files/jinglescriptFiles.ts`:
  - an `AsyncLocalStorage<string>` holding the calling session's cwd, set by a middleware on
    `POST /api/plugin/manageJingleScript` only (mounted next to `mountPresentPathRoot`);
  - `jingleScriptFileOps`: render targets go to the repo's confined `createFileOps` rooted at
    `<cwd>/jinglescript` (creates the folder and files, refuses escapes, symlinks checked); score targets go to
    `jingleScriptByPath` as before (read / overwrite only).
- `manageJingleScript` leaves `PRESENT_PATH_EXTENSIONS`: the ops resolve a relative path themselves, so the
  plugin keeps the path it told the model. With the rewrite, `renderScore({ path: "jinglescript/song.json" })` in
  a project session reached the plugin as an absolute path, the plugin did not recognise the score as the
  render's own, and named the render `song-2`.
- Deferred audio: MulmoTerminal does not set `deferredAudio`, so the write happens inside the request. The store
  still reaches a continuation after the response (Node restores the async function's context after `await`);
  a spec pins that with `deferredAudio: true` collected outside the store.

## Verification

- Pure function: normal and abnormal inputs both directions.
- Ops + plugin: render / compose with relative paths land under the session dir; the workspace when no session.
- `sessionRelativePath` extraction: old vs new `absolutizePresentPath` run side by side on generated inputs.
- Real server: `POST /api/plugin/manageJingleScript` with the session header, files appear under the session dir.
