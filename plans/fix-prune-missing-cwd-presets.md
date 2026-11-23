# fix: missing folders pile up in the launch panel (#3414)

## Problem

`cwdPresets` gains an entry on every launch (`recordPreset` → `/api/config/cwd-presets/record`) and
loses one only when the user presses a chip's close button. A deleted worktree or scratch directory
stays a chip forever. The only existence check is `deriveCwdPresets`, which seeds the list once.

## Rule

A saved directory that does not exist is one of two things, told apart by its parent:

| path | parent | meaning | action |
|---|---|---|---|
| absent | present | deleted | remove from `cwdPresets` on disk |
| absent | absent | not reachable now (unmounted drive, network share) | keep on disk, hide from launch chips |
| present / not ENOENT | — | there, or unknown (EACCES) | nothing |

Only `ENOENT` / `ENOTDIR` count as absent — a permission error must never delete a saved entry.
Relative entries are left alone (they cannot be judged, and cannot launch anyway).

## Shape

- `server/config/dir/missing-presets.ts` — pure `classifyMissingPresets(paths, isAbsent)` →
  `{ gone, unreachable }`. The fs probe is injected.
- `isAbsentDir` beside it in `cwd-presets.ts` (the IO half).
- `POST /api/config/cwd-presets/prune-missing` — removes `gone` from the list ON DISK under the
  config lock (same reasoning as `record` / `remove`: never a client's copy). Answers
  `{ cwdPresets, unreachable }`. Writes nothing when nothing is gone.
- Client: `useAppConfig` keeps the raw list internally (`savedPresets`, what every write and the
  version guard work on) and exports `presets` as that list minus `unreachablePresetPaths`, so
  every surface GridView feeds (launch panel, empty-cell form, palette, Settings, the preferred-dir
  pick) stops offering an out-of-reach directory. `pruneMissingPresets()` is serialized with the
  other preset writes.
- Triggers: `loadConfigThenPruneMissing` on GridView mount (the check runs after the read, never
  racing it — it counts as a local write, so a failed check landing first would make the read
  discard its list), and LaunchPanel emits `opened` on mount, which GridView answers with the check.
  `loadConfig` itself is unchanged: its retry contract counts requests.

## Why hide via a separate field, not by filtering `cwdPresets` in the response

A replace-all `POST /api/config` of `cwdPresets` exists. If the GET dropped hidden entries, any
client building that POST from what it read would delete them from disk — exactly what "hide"
promised not to do. The raw list stays whole on the client for the same reason.

## Not changed

Collection serving, project roots and every other reader of `cwdPresets`.
