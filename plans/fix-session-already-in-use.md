# fix: "Session ID … is already in use." when opening a past session

## Symptom

Opening a past session from the single-view tab list sometimes shows, in the terminal:

```
Error: Session ID <uuid> is already in use.
```

Reported by multiple users. Appeared with the tmux-backed session-persistence release.

## Root cause (verified against real claude 2.1.206)

The error is emitted by the `claude` CLI itself. Verified rule, by probing real claude
with node-pty:

- `claude --session-id X` → **"Session ID X is already in use."** iff a transcript for X
  already exists on disk (`~/.claude/projects/<cwd>/X.jsonl`). It's a transcript-exists
  check, not a live-process lock.
- `claude --resume X` → resumes an existing transcript; two concurrent `--resume X` both
  succeed. `--resume` never emits the error.
- Concurrent `--session-id X` on an id with **no** transcript is fine.

So the bug is: the server launches `claude --session-id X` for an id whose transcript
exists — where it should use `--resume X`.

`server/index.ts` `resolveClaudeSession` gated resume on `!tmuxAlive`:

```
const resume = !reattachId && !tmuxAlive && requested && sessionExistsOnDisk(...) ? requested : null;
```

When a tmux session for X is alive, `resume` was forced to null, so the spawn used
`--session-id X`. That is harmless **only if** `tmux new-session -A -s mt-X` attaches to
the live session (the arg is ignored). But if `mt-X` died between the `tmuxHasSession`
check and the spawn — a reap, a `/exit`, or another MulmoTerminal instance on the shared
`-L mulmoterminal` server (the user runs several) — `new-session -A` **re-creates** the
session and RUNS `claude --session-id X` → the error.

tmux itself is transparent; what the persistence feature introduced is long-lived tmux
sessions that outlive a tab/instance and can vanish out from under a check.

### Reproduction (side-effect-free, isolated socket + stub claude)

- `tmux new-session -A -s mt-X -- <stub> --session-id X` with mt-X absent + transcript on
  disk → "already in use". (before)
- same with `--resume X` → resumes cleanly. (after)

## Fix

`resume` is set whenever a transcript exists on disk, regardless of tmux liveness. An
on-disk id is now always launched under `--resume`, never `--session-id`:

- tmux session alive → `new-session -A` still attaches; the `--resume` arg is ignored
  (no behavior change on the happy path).
- tmux session gone at spawn → `new-session` re-creates and runs `--resume X`, which is
  safe, instead of the fatal `--session-id X`.
- Idle session with a live tmux session but no transcript yet → unchanged (`--session-id`
  attaches; safe because no transcript exists).

The flag decision is extracted into `server/session-resolve.ts` (`resolveSession`, pure)
with `server/session-resolve.spec.ts` covering the matrix, including the regression case
(on-disk **and** tmux alive → `resume` set).
