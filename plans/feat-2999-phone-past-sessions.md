# feat: the phone lists a directory's past sessions and reads their conversation (#2999)

Phone side: receptron/mulmoserver#351.

## Goal

From an open terminal on the phone, list the past sessions of that terminal's directory (every
hosted agent, the same rows the grid's "or resume here" picker reads) and read any of them as the
formatted conversation `getTerminalTranscript` already serves for a live session.

## Commands

| Command | Params | Answers |
| --- | --- | --- |
| `listPastSessions` | `sessionId` | `{ cwd, sessions: PastSessionRow[] }` |
| `getPastTranscript` | `sessionId`, `pastSessionId`, `before?` | `TranscriptPage` |

`PastSessionRow = { id, title, mtime, agent, readable, account? }`, newest first, capped.

## Decisions

- **The phone names an open session, never a path** — the same boundary as `launchTerminal`
  (#831). The directory is `cwdOfSession(sessionId)`; an empty one is refused.
- **`getPastTranscript` only reads an id the directory's list holds.** codex's reader locates a
  rollout by id alone, so without the check any codex conversation on the machine would be
  readable through any open session. The check re-lists; the command is tapped, not polled.
- **Unreadable agents (agy, grok, muse) are listed with `readable: false`** and answered
  `not-supported` without opening anything — the user asked to see them in the list.
- **Paging reuses `sessionTranscriptPage`** and its opaque cursor, so each reply stays inside the
  existing byte cap and the 1 MiB command document. A malformed `before` is refused, as the browser
  route refuses it.
- **One agent's broken store does not empty the list**: each lister is settled separately.
- Background workers, translation workers and probe sessions are left out of claude's rows — they
  are not conversations a person had.
- The routes in `session-routes.ts` are untouched apart from `transcriptFilesIn` moving next to
  `claudeDiskStats`, its only other user being the new lister.

## Files

- `server/session/list/past-session-rows.ts` — pure: merge per-agent rows, sort, cap, readable flag,
  lookup by id. Spec in `test/server/session/list/past-session-rows.spec.ts`.
- `server/session/list/past-sessions.ts` — the per-agent listers and the transcript read.
- `server/backends/remoteHost/handlers/pastSessions.ts` — the two handlers (sharing `sessionIdOf`
  from `terminalSession.ts`); `deps.ts`, `index.ts`, `hostBindings.ts` — their wiring.
- `docs/remote-host-protocol.md` — the command table and wire shapes.
