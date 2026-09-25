# feat: show a codex approval prompt as "needs input" (#2245)

## Problem

A codex cell reads "working" for as long as codex sits on its own approval dialog. Its status comes
from the rollout tail (`server/agents/codex-activity.ts`), which knows turn boundaries only, and the
rollout records nothing while the dialog is up.

## What changed underneath

Codex 0.156.1 ships hooks (`codex features list` → `hooks stable true`) in claude's shape, including
`PermissionRequest`. Measured against that build (issue comment on #2245):

- `PermissionRequest` fires when the dialog is SHOWN, and only then — a turn of tool calls that needed
  no approval fired none. So, unlike copilot's `permissionRequest` and cursor's
  `beforeShellExecution`, it can be mapped to `Notification`.
- Approving fires `PostToolUse`, then `Stop`. Denying (Esc) interrupts the turn and fires neither; the
  rollout records `turn_aborted`, which the tail already reports as the turn's end.
- Hooks passed with `-c` are subject to a one-time "Hooks need review" dialog. Trust is stored in the
  user's `~/.codex/config.toml` under `hooks.state."/<session-flags>/config.toml:<event>:0:0"`, keyed by a
  hash of the handler. Passing that state with `-c` does not count.
- The hook's child inherits codex's environment, and the command runs through a shell (`$VAR`
  expands).

## Design

- Register ONE hook, `PermissionRequest`, via `-c`. The rollout tail stays the source of turn
  boundaries: it works without trust, so a user who declines the dialog keeps what they have today.
- The command is a CONSTANT. Port and session id come from `MULMOTERMINAL_PORT` /
  `MULMOTERMINAL_SESSION_ID` in the environment, so the hash never changes and the review dialog is
  answered once per machine rather than once per cell.
- `/api/hook` gets a `codex` translator: `PermissionRequest` → `Notification` with
  `notification_type: "permission_prompt"` and the dialog's reason as `message`. The session comes from
  the `x-mt-session` header only — the payload's `session_id` is codex's rollout id, which is a valid
  uuid but not ours, so it is not forwarded.
- Not registered when:
  - the spawn types a seed prompt (`initialPrompt`): if the review dialog is up, the typed prompt and
    its Enter land on it — Enter picks "Review hooks" and the prompt is lost. A hidden background chat
    has no one to recover it.
  - on Windows: the command relies on sh expansion and `/dev/null`, and how codex runs a hook there
    has not been measured.

## Out of scope

- Replacing the rollout tail with `UserPromptSubmit` / `Stop` hooks.
- Tool history for codex from `PreToolUse` / `PostToolUse`.
