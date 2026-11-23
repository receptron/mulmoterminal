# startIssueSession: a session hands an issue to an implementer of its own (#3413)

Part one of #3413 (child 4 of #3403). The other parts, each its own PR: the server telling the
dispatcher when an implementer finishes or stops, and the dispatcher's skill.

## What it does

A new host tool, `startIssueSession { repo, issue, agent }`, offered where `spawnBackgroundChat` is
(the all-tools url). It cuts the issue's worktree through `startIssueWork` — the same call the
board's start button makes, so the branch name, the one-session-per-worktree check and the
"this issue already has a worktree" reuse stay in one place — and starts an implementer there that
runs `mulmoterminal-issue-to-merge` on the issue.

The implementer:

- is a visible cell (`markUnplacedSession`), as a non-hidden `spawnBackgroundChat` session is;
- carries the whole GUI MCP, so it has the review tools — `issueSpawnOptions` and the codex /
  copilot spawns take `allTools`, which only this path sets;
- is recorded as started by the caller, so the caller can `sendToSession` to it;
- is recorded in the issue-session table, which is what the limit counts.

## Decisions

- **Agents: claude, codex, copilot.** `FULL_GUI_MCP_AGENTS` — the agents handed their MCP per
  spawn. The others read it from a file every session in the directory shares, so they cannot be
  given the review tools without giving them to the user's own cells there too.
- **The limit is `maxIssueSessions` in the global config**, default 2. It counts implementers
  this tool started that are still running here (and starts in flight, claimed before the first
  await so two calls cannot both pass). Machine-wide rather than per repository, because the cost
  it bounds — sessions, tokens, CI — is the machine's.
- **The clone is the repository's default clone** (`defaultCloneOf`), as for the review settings.
- **A worktree whose session is already there is refused**, not resumed: that session was not
  started with the review tools, and typing into it would land on whatever the user left there.
- **The seed is prose** (`Use the "mulmoterminal-issue-to-merge" skill ...`), the form codex already
  turns a `/skill` seed into, so one text works for all three agents.

## Out of scope

- Notifications (the next PR). Until then an implementer counts against the limit until its
  session ends.
- Persisting the table across a restart (in memory, as `spawnedSessions` is).
