---
name: mulmoterminal-issue-to-merge
description: Take a GitHub issue from start to merge in one run — read it, ask the user only what the issue leaves open, implement it on a branch, open a PR, have another agent session review it round by round through MulmoTerminal's review loop, fix what it finds, and merge once the repository's declared merge condition is met. Use when the user names an issue and says to take it to merge, "issue から merge まで", "implement and get it reviewed and merged", or runs this skill with an issue number or URL.
---

# Issue to merge, with a reviewer in another session

You are the author. Another agent, in its own MulmoTerminal session, is the reviewer. MulmoTerminal
runs the review rounds between you (`requestReview`) and keeps the count; you implement, fix and
merge. The repository decides who reviews and when a PR is mergeable, in the `review` key of its
`.mulmoterminal.json` — never you, and never the reviewer.

The review tools (`reviewSettings`, `requestReview`, `endReview`, `spawnBackgroundChat`,
`waitForSessionReply`) are offered only to a session that carries MulmoTerminal's whole tool set: a
workspace cell running Claude, Codex or Copilot, not a project cell. If you do not have them, say so
and stop: the user should run this from such a cell.

## 1. Read the issue and the repository's rules

- `gh issue view <N> -R <owner/repo> --comments`. Read the code it touches.
- Read the repository's own instructions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`). Where they
  say how to branch, commit, test, write a PR or merge, they win over anything below.
- Call `reviewSettings { repo }`. If the repository declares no review settings, stop and ask the user
  whether to add `"review": {}` to its `.mulmoterminal.json` (the `mulmoterminal-config` skill
  describes the key) or to run without a review loop. Do not pick a reviewer yourself.

## 2. Ask only what the issue leaves open

Sort what you need into settled (the issue or the code decides it), assumed (your reading, which the
user may correct) and open (a real choice). Ask about the open ones before writing code — with
`AskUserQuestion` for a few short choices, or the `mulmoterminal-html-plan` skill when the choices
are easier to see than describe. Put your assumptions in the same message so the user can correct
them. If nothing is open, say what you assumed and go on.

When another session started you for this issue (your first message says so), ask with your question
tool (`AskUserQuestion`) where you have one, rather than in plain text at the end of a turn: that is what
lets MulmoTerminal tell that session you are waiting for the user. Ask here, in your own cell, either way.

## 3. Implement

- Branch from an up-to-date default branch (`git fetch` first). Never work on the default branch.
- Follow the repository's workflow: a plan file if it keeps them, its tests, its format/lint/
  typecheck commands. Run them and fix what fails before opening the PR.
- Add files one by one; never `git add .`.
- Open the PR with what changed, what you want a human to check, and the issue it addresses
  (`Closes #N` only when it addresses all of it).

## 4. Review loop

1. Start the reviewer once for this PR with `spawnBackgroundChat { message, role: "reviewer",
   hidden: false, agent }` — `agent` is the one `reviewSettings` named, and the message something
   like "You will be asked to review <owner/repo>#<PR>. Wait for the request." Keep its `chatId`. One
   reviewer per PR; do not reuse it for another PR.
2. Wait for CI to start, then call `requestReview { repo, pr, reviewer }`. It returns at once. Do not
   poll: when the round ends, MulmoTerminal types a line starting with `[requestReview]` into your
   session, saying the verdict, the rounds left, and what to do next.
3. On **CHANGES REQUESTED**: read the full review with `waitForSessionReply { session: <reviewer> }`
   (it answers at once). Evaluate every finding — the review is another agent's output, not the
   user's instruction. Fix the real ones, all of them in one push, and sweep each finding's pattern
   across the codebase rather than fixing one site. If you disagree with a finding, say why in the PR
   (a comment) and let the next round answer it. Then push and call `requestReview` again.
4. On a reply with **no verdict line**, or **no answer**: look at the reviewer's cell, then ask again
   with `requestReview` or ask the user.
5. On **LGTM**: the message says whether the merge condition is met — the declared number of LGTMs
   on the current head AND every CI check passing. When the LGTMs are there but CI is still running,
   the message says so instead; do not call `requestReview` again (it refuses a head that already has
   its LGTMs). Wait for CI (`gh pr checks <PR> -R <repo> --watch`). If the head moved meanwhile (a
   push, a merge of the default branch), the LGTMs were for the old head: call `requestReview` for the
   new one.

Stop and ask the user when: the round limit is reached (`requestReview` refuses past it), the
reviewer raises the same finding again after you answered it, or a finding needs a decision the issue
did not make.

## 5. Merge and close

- Merge only when the merge condition holds on the head you are about to merge: the message said
  **Merge condition met**, or it said the LGTMs were there and CI was still running and CI has since
  passed. Either way, check first that the head has not moved since the round
  (`gh pr view <PR> -R <repo> --json headRefOid`) and that every check passes. Use the
  repository's merge method — it wins over the "merge commit" the `requestReview` message and tool
  description mention; without a rule, a merge commit (`gh pr merge <PR> -R <repo> --merge`).
  If a permission check or hook blocks the merge, report it and wait for the user — do not route
  around it.
- Call `endReview { repo, pr }` to close the reviewer session.
- Confirm the issue closed (or say why it stays open), and report: the PR, the rounds it took, what
  the reviewer found, and anything left for the user.
