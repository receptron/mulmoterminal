# fix: a codex the server starts never stops on an approval prompt (#3459)

## Problem

The codex sessions the server starts, an implementer (`startIssueSession`) and a reviewer
(`requestReview`), run with codex's own default approval policy. An operation outside the sandbox
stops them on an approval prompt, and nobody is watching those cells to answer it. #3451 and #3454
gave them what commit, push and the PR need, but any other write outside the sandbox still stops them.

## Change

- `buildCodexArgs` takes `neverAsk` and emits `-c approval_policy="never"`. The sandbox stays: what
  it refuses comes back to codex as a failure, and codex works around it.
- The issue spawner and `spawnCodexPty` carry the option, for this spawn only, as they carry
  `networkAccess`. Other agents ignore it.
- `implementerSpawn` and the reviewer spawn in `review-workspaces.ts` ask for it.
- en/ja `config.md` say so, beside the network sentences.

## Measured

Interactive codex 0.172.0 started with `-c approval_policy="never"` and asked to `touch` a path
outside the workspace: no prompt appeared, the command exited 1, and no file was created. Without
the flag, the #3449 trial stopped on the prompt.

## Out of scope

- A codex cell the user opens themselves keeps the user's settings.
- Dropping the sandbox (`--dangerously-bypass-approvals-and-sandbox`).
- A cold resume drops this, as it drops `networkAccess` and the writable roots (see #3454's plan).
