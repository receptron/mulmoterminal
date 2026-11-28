# fix: the Library resumes a conversation outside the list without asking who holds it (#3343)

## Cause

The Library's Resume reads the conversation's directory list (`/api/sessions`) and refuses a row
that is `attached` or open in this grid. That list is the newest `SESSION_LIST_LIMIT` transcripts
only, so a conversation left open (and idle) in another tab or on another device falls off it.
`libraryResume` then took "not in the list" as "free" and opened it by its id. A Claude session's
key is its conversation id, so the new cell reattached to the live PTY and `reattachPty` sent the
original client `superseded`.

The command palette shares `isBusyResume` but is not affected: its rows ARE the list's rows, so a
conversation outside the list is never offered.

## Fix

- `GET /api/sessions/occupancy?id=<id>` answers, for one session id, the same two fields a list row
  carries (`attached`, `runningKey`), with no list and so no cap. Both the list rows and this route
  build them through one `sessionOccupancyOf` in `server/session/dir-session.ts`, so the two cannot
  answer differently.
- The Library asks it only when the list was read and does not name the conversation.
  `libraryResume` takes that answer: busy refuses as before, free resumes by `runningKey ?? id`, and
  an unreadable answer is `unchecked` (nothing is resumed), the same as an unreadable list.
- The palette is unchanged.

## Verification

- `libraryResume` spec: outside the list, held / free / running-under-a-key / unanswerable / open in
  this grid.
- Route spec: invalid id is 400; a held and a free id answer through the same fields as the list.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
