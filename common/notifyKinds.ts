// The moments MulmoTerminal can notify you about. The attention sound reads this whole
// list; Web Push reads the PUSH_KINDS subset in pushKinds.ts, because a phone can only be
// told about what the SERVER observes — the four kinds added below are seen in the browser.

// Every kind that exists.
//   finished       — the turn ended, output is waiting to be reviewed.
//   waiting        — the agent is blocked on input (a permission prompt or a question).
//   command-done   — a Run cell's command exited 0.
//   command-failed — a Run cell's command exited non-zero.
//   session-exited — a session's PTY ended. Closing a cell yourself goes through the same
//                    path, so this one fires on a deliberate close too.
//   worker-failed  — a hidden background worker ended without ever completing a turn. The one
//                    kind raised for a session with no cell on screen: a worker is invisible by
//                    design, so nothing else would ever say so.
//   pr-ci-failed   — a directory's PR phase became ci-failing. The phase poll runs only
//                    while the roster is on screen, so a failure that lands while you are
//                    in another view is not seen.
export const NOTIFY_KINDS = ["finished", "waiting", "command-done", "command-failed", "session-exited", "worker-failed", "pr-ci-failed"] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number];

// What a config with no `soundKinds` gets. Deliberately a SEPARATE list from NOTIFY_KINDS,
// not a copy of it: a kind added later must NOT start beeping at people who never asked for
// it — the same rule DEFAULT_PUSH_KINDS documents, and the reason the four kinds above are
// absent here. Add a kind to NOTIFY_KINDS so it can be switched on, and leave it out of
// here so it stays opt-in.
export const DEFAULT_SOUND_KINDS: NotifyKind[] = ["finished", "waiting"];

export const isNotifyKind = (value: unknown): value is NotifyKind => NOTIFY_KINDS.some((kind) => kind === value);
