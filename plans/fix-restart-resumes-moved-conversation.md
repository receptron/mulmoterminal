# fix: a restart resumes the conversation a /clear or an in-cell /resume moved to

## Problem

The cleared-transcript mark (`server/session/transcript/cleared-transcripts.ts`) is what tells
`resolveSession` that a session's own transcript is frozen and which id its live conversation moved
to, so a cold spawn `--resume`s that successor (#2013). Two paths lost it:

- **Reap dropped the mark.** `reap()` called `forgetClearedTranscript(id)`, on the reasoning that the
  next claude on this id appends to that file again. But a cell Restart is reap followed by a spawn
  that reads the mark, and `resolveSession` never resumes the frozen file itself. So the mark was
  gone exactly when it was read, and the Restart (or reopening a cell after an idle reap or `/exit`)
  `--resume`d the conversation the user had ended with `/clear`.
- **An in-cell `/resume` was never marked.** It moves claude to another conversation's transcript
  while the session keeps its id, just as `/clear` does, but it was remembered only in the in-memory
  `claudeSessionIds`. Any restart resumed the session's own id: the abandoned conversation, or none
  at all for a cell that resumed before its first prompt (and then a brand-new session started).

Most visible on Windows (psmux), where most reconnects are cold spawns, but not platform-specific.

## Fix

- `SessionStart` with `source=resume` takes the same durable mark as a clear when claude reports an
  id other than the session's own and other than the successor already recorded
  (`resumeMovedConversation` in `server/routes/hook-routes.ts`; `header-hook.ts` now returns a
  `resume` effect). A restart that resumes the recorded successor fires the hook again with that
  id, which is why the second exclusion exists: without it, every restart would re-mark and blank
  the header.
- `reap()` keeps the mark.
- Since reap no longer prunes marks, hydration at boot drops one when neither the session's own
  transcript nor the successor's is on disk. A mark with only the successor's transcript is kept:
  a session cleared before its first turn has no file of its own, and its mark still routes the
  restart.

## Left out

- A mark whose transcript is appended to by something outside this server is still only noticed at
  the next boot, by the existing size check. That was already true before this change.
