# fix: missing folders pile up in the launch panel (#3414)

## Problem

`cwdPresets` gains an entry on every launch (`recordPreset` → `/api/config/cwd-presets/record`) and
loses one only when the user presses a chip's close button. A deleted worktree or scratch directory
stays a chip forever. The only existence check is `deriveCwdPresets`, which seeds the list once.

## Rule

A saved directory that does not exist is one of two things, told apart by its parent:

| path | parent | meaning | action |
|---|---|---|---|
| absent | present, not empty, and not a mount root | suspected deleted | hide, record when first seen; remove from `cwdPresets` on disk only when a check at least `MISSING_CONFIRM_MS` (a day) later still finds it missing |
| absent | absent, EMPTY (a mount point left behind by an unmount looks like this), a dangling symlink, or a mount root (`/Volumes`, `/media`, `/mnt`, `/run/media`, `/media/<user>`, `/run/media/<user>`) | could be an unplugged drive | keep on disk, hide |
| a dangling symlink itself | — | link onto something not mounted | keep on disk, hide |
| present / not ENOENT | — | there, or unknown (EACCES) | nothing |

Only `ENOENT` / `ENOTDIR` count as absent — a permission error must never delete a saved entry.
Relative entries and filesystem roots are left alone (nothing to judge them by).

A single "not found" is never proof: a network share can answer ENOENT for a moment. Each
suspected deletion is recorded in `~/.mulmoterminal/missing-dirs.json` (path -> first seen), read and
written under the config lock; a directory that comes back or leaves the list drops out of it.

## Shape

- `server/config/dir/missing-presets.ts` — pure `classifyMissingPresets(paths, isAbsent)` →
  `{ gone, unreachable }`. The fs probe is injected.
- `probeDir` beside it in `cwd-presets.ts` (the IO half): `stat`, then `lstat` to tell a dangling link.
- `POST /api/config/cwd-presets/prune-missing` — `decidePrune` (pure) under the config lock, then
  removes the confirmed deletions from the list ON DISK under the config lock (same reasoning as `record` / `remove`: never a client's copy). Answers
  `{ cwdPresets, unreachable }`. Writes nothing when nothing is gone, but still reads under the lock,
  since the client adopts the answer as the whole list. An unreadable file is a 409, never `[]`.
- Client: `useAppConfig` keeps the raw list (`savedPresets`, what every write and the version guard
  work on) and exports `presets` as that list minus `unreachablePresetPaths`, so the launch surfaces
  GridView feeds (launch panel, empty-cell form, palette, the preferred-dir pick) stop offering an
  out-of-reach directory. Settings is handed `savedPresets` instead, so a hidden entry is still
  listed somewhere — the chip's close button is hidden with it. `pruneMissingPresets()` is serialized with the
  other preset writes.
- Triggers: `loadConfigThenPruneMissing` on GridView mount turns on a check after EVERY adopted read,
  a background retry included (the check runs after the read, never
  racing it — it counts as a local write, so a failed check landing first would make the read
  discard its list), and LaunchPanel emits `opened` on mount, which GridView answers with the check.
  `loadConfig` itself is unchanged: its retry contract counts requests.
- `mutateOneOnServer` bumps `version` only when it ADOPTS an answer. A failed call wrote nothing,
  and bumping anyway made an in-flight retried config read discard its list (a check fired by
  opening the panel during a backend restart; a record or remove at that moment did the same).

## Why hide via a separate field, not by filtering `cwdPresets` in the response

A replace-all `POST /api/config` of `cwdPresets` exists. If the GET dropped hidden entries, any
client building that POST from what it read would delete them from disk — exactly what "hide"
promised not to do. The raw list stays whole on the client for the same reason.

## Not changed

Collection serving, project roots and every other reader of `cwdPresets`.
