# fix: a codex implementer started by startIssueSession reaches the network (#3451)

## Problem

`implementerSpawn` (`server/routes/issue-session-routes.ts`) started the implementer with
`{ allTools: true }` only. codex's `--sandbox workspace-write` has no network by default, so a codex
implementer stopped on an approval prompt for its first `gh issue view`, and again for every push and
PR command. The reviewer already gets `networkAccess: true` (#3425); the implementer needs it for the
same reason: everything it does after editing goes to GitHub.

## Change

- `implementerSpawn` passes `networkAccess: true`. Agents other than codex ignore the option.
- The spec pinning `implementerSpawn`'s options now expects it. `issue-session-spawn.spec.ts` already
  covers the option reaching `spawnCodexPty`, and `codex-args.spec.ts` covers the `-c` flag.
- en/ja `config.md` say a codex implementer may reach the network, beside the reviewer's sentence.

## Out of scope

A cell the user opens on an issue themselves (the board's Start Work) keeps the user's own sandbox:
the user is watching it and can answer the prompt.
