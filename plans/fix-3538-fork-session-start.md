# fix: follow a conversation Claude Code moved to the background (#3538)

## Problem

Pressing ← in a Claude Code cell moves the conversation to the background, and Claude Code
continues it under a NEW session id. The cell's activity timeline, conversation pane, header reply,
roster title and push body all keep reading the transcript filed under the OLD id, so they stop at
the moment ← was pressed. The prompts pane alone keeps up, because it reads the id hooks report
(`claudeSessionIds`). Reopening the cell after its tmux session ended resumes the old id (#1812).

## What Claude Code sends (observed on 2.1.332)

A hook-logging `--settings` on a plain tmux claude, then ←, then one more turn:

- the forked process (`--fork-session --resume <old id>`, run under Claude Code's background
  daemon) sends `SessionStart` with `source: "fork"` and the NEW `session_id`;
- every later hook comes from that process, under the new id, and still carries our
  `x-mt-session`, because `--settings` is passed on to it;
- the old process sends nothing after ←;
- the old transcript ends with a `continued-in` record naming the new id.

## Fix

`conversationMove()` knew `clear` and `resume` only, so `fork` was `"none"` and no mark was made.

- `fork` becomes a new move, `"follow"`: the same conversation went to another id. Like `resume`, it
  needs a usable id that is neither ours nor the recorded successor.
- `followForkedTranscript()` records that id as the mark's successor, which is what
  `transcriptIdOf()` and the respawn (`ws-routes.ts`, #3325) read. The respawn path is how #1812
  gets fixed as well.
- It keeps whatever boundary the mark already had, and draws none of its own. The boundary is the
  prompts pane's "this conversation starts here" line. A fork continues the conversation, so the
  prompts before ← stay in the pane, and an earlier `/clear`'s boundary stays where it was.
- The header prompt, the header reply and the AI title are left alone, since the conversation is
  the same one.

## Out of scope

- Claude Code's pre-warmed `bg-spare` process also posts a `SessionStart startup` under our
  `x-mt-session` with an unrelated id, and `claudeSessionIds` takes whatever id the latest hook
  carries. It is not a move (`startup` → `"none"`), but the prompts pane could read that id if it
  arrives after the fork. This needs its own issue.
- Whether the background daemon can be shared between cells, which would give the forked process
  another cell's environment. Not observed.
- The FAQ entry for #1812 describes the old behaviour; it is updated here (en/ja).
