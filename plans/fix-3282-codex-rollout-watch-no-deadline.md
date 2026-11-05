# A fresh Codex cell's rollout is caught however late its first prompt comes (#3282)

## Problem

codex writes a session's rollout only after the first user turn. `captureCodexRollout` watches for
it, but `watchForCodexSession` gave up after a thirty-minute default. A cell whose first prompt came
later was never mapped, so its working/waiting dots and turn-complete notice stayed dead.

The watcher was always meant to run for the session's lifetime (it is cancelled when the pty goes);
the deadline was a safety cap that became the bug.

## Scope

- **In:** the watcher has no deadline unless a caller asks for one, and it keeps looking in the day
  folder the cell started in.
- **Out (#3283):** a session that already lost its mapping and then went through a restart. Its
  rollout is in the snapshot, so finding it means attributing an EXISTING file, which needs evidence
  the snapshot diff does not have.

## Design

- `maxWaitMs` is optional and absent means "until cancelled". The spawn path passes none.
- **The day folder.** codex fixes the rollout path when the session starts: the reported file was
  named 22:40 and created at 23:12. So a first prompt on a later day writes into the START day's
  folder, which "today and yesterday" stops covering after a day. `rolloutDayDirs` (pure, its own
  file) returns today, yesterday and the start day, deduplicated.
- **Polling forever re-reads foreign files.** A rollout that is fresh but not this cell's (another
  directory, ambiguous) used to be re-read each second for thirty minutes; now it would be read for
  the cell's life. The watcher keeps each file's meta once read; the first line never changes, and a
  file whose meta is not there yet is not kept.

## Verification

- `rolloutDayDirs`: same day, a start the day before, several days before, the month and year edge.
- Watcher, with fake timers: still watching past thirty minutes and catching the rollout; catching a
  rollout in the start-day folder two days later; a foreign file read once; cancellation still stops
  it. The first two fail on main.
