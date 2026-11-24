---
name: mulmoterminal-dispatch-issues
description: Hand several GitHub issues the user names to implementer sessions that run in parallel, each in its own worktree and cell, each taking its issue to merge through another session's review — and follow them, starting the next issue as a place frees and telling the user when one needs them. Use when the user names more than one issue to be done ("#12 #15 #18 を進めて", "work these issues in parallel", "dispatch these to agents"), or runs this skill with a list of issues.
---

# Dispatch issues to implementers

You are the dispatcher. You do not implement, review or merge anything. For each issue the user named,
MulmoTerminal starts an implementer (`startIssueSession`): it cuts the issue's worktree, gives the
implementer a cell, and the implementer runs `mulmoterminal-issue-to-merge` — its own questions, its own
review loop, its own merge. MulmoTerminal follows each one and types a line starting with
`[startIssueSession]` into your session when one finishes or needs the user. You keep the queue.

`startIssueSession` is offered in the workspace session. If you do not have it, say so and stop: the user
should run this from the workspace cell.

## 1. Take the list as the user gave it

- The issues are exactly the ones the user named, as `owner/repo#N`. Do not add an issue, and do not
  pick one yourself; ask for the repository when the user gave only a number and it is not clear.
- The agent is the one the user named (`claude`, `codex` or `copilot`), or `claude`.
- GitHub only: `startIssueSession` refuses another forge.

## 2. Check each repository can be reviewed

Call `reviewSettings { repo }` once per repository. When one declares no review settings, its
implementers would stop at their review step: tell the user, and ask whether to add `"review": {}` to its
`.mulmoterminal.json` (the `mulmoterminal-config` skill describes the key) or to leave its issues out.
Do not start them until that is settled.

## 3. Start as many as the limit allows

Call `startIssueSession { repo, issue, agent }` for the issues in the order the user gave them, until one
is refused for the limit (`maxIssueSessions`). Keep the rest as the queue. A refusal for another reason
(the issue already has a session in its worktree, no clone, not on GitHub) is that issue's answer: report
it and go on with the next.

The limit counts every implementer on this machine, not only yours, and you are told only about the ones
you started. So when the limit refuses while **none of yours is running**, nothing will arrive to start
the queue: tell the user the places are taken by other sessions, and try the next issue again when the
user asks you to.

Then tell the user, in one short message: which issue runs in which cell (its session id), which are
queued, and that **each implementer asks its questions in its own cell — answer them there**.

## 4. Wait, and act on each line

Do not poll, and do not read the implementers' cells to check on them. Each `[startIssueSession]` line
says what happened:

- **merged** — the place is free: start the next queued issue, if any. MulmoTerminal has already closed
  the implementer, its reviewers and its worktree; the line says what it kept and why.
- **closed without merging** — the same close has happened. Tell the user which issue, and anything the
  line says was kept (a worktree with unpushed work). Start the next queued one. Do not restart the same
  issue on your own; ask the user.
- **session ended** — its cell is gone but its worktree and any reviewer are not. Tell the user which
  issue, close it with `closeIssueSession { session }`, pass on what that answers, and start the next
  queued one. Do not restart the same issue on your own; ask the user.
- **waiting for the user** — tell the user which issue and which cell needs them. Do not answer its
  question, and do not `sendToSession` an answer on the user's behalf.

A start the limit refuses here (another session took the place) stays queued, and is tried again at your
next line — or, when none of yours is running any more, when the user asks, as in step 3.

When the user asks for an issue to be added or dropped, change the queue; an implementer already started
keeps running until it finishes. When the user asks you to stop one that is still working,
`closeIssueSession` refuses it; call it again with `force: true` only on the user's word. Only you, the
session that started it, can close it.

## 5. Report when the queue is empty and every implementer finished

One line per issue: the PR and how it ended (merged, closed, ended, or not started and why), and anything
the user still has to do.
