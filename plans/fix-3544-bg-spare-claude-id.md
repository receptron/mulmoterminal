# fix: a hook that does not speak for the cell's conversation stops re-learning claude's id (#3544)

## Problem

`/api/hook` records the `session_id` of EVERY hook as the id claude currently calls itself
(`claudeSessionIds`, #1749), and the prompts pane reads that id ahead of the mark's successor.

Two hooks carry an id that is not the conversation the cell shows:

- Claude Code 2.1.332's pre-warmed `bg-spare` process inherits `--settings`, so its
  `SessionStart` `startup` arrives under our `x-mt-session` with an unrelated id. On ← it arrived
  before the forked process's `SessionStart` `fork`, and the pane read the spare's id until then.
- `SessionEnd` from every process at teardown, in no fixed order, so the last one decides what is
  left. It can also arrive after `lifecycle.ts` dropped the mapping for a closed cell and write it
  back.

## Fix

A pure rule, `speaksForConversation(event, source)` in its own file: `SessionEnd` and
`SessionStart` `startup` do not; every other hook does. The route records the id only for those.

Why losing those two costs nothing:

- a fresh cell's claude is spawned with `--session-id <ours>`, so its `startup` carries our own id,
  which is what the pane reads with no mapping at all;
- a respawn that resumes announces `resume`, and `/clear`, `/resume`, ← announce `clear`, `resume`,
  `fork` — all still recorded;
- `SessionEnd` ends the process that sent it, so its id is never the one the cell goes on in.

## Out of scope

- Recording only for sessions with a live pty. After a server restart hooks arrive before the
  browser reattaches, and #1749 relies on learning the id from them.
