# Clear the open jscpd duplicate-code alerts

Code Scanning (category `jscpd`, the `duplication-scan` workflow) had open duplicate-code alerts in
three groups. Each is fixed by moving the shared rule to one place, not by ignoring the scan.

## Agent log readers (copilot / antigravity / grok last turn)

The three readers each carried the same exchange fold and the same "is there a tool list" test.
They now say only which records are prompts and answers (`ExchangeReader`) and call
`lastCompleteExchange` / `newestPromptReply` in `server/session/transcript/exchange-fold.ts`.

## Transcript views (antigravity / grok, and the same clip in codex / cursor)

The tool-call row (name, clipped arguments) was written four times with one cap; it is now
`toolCallRow` in `transcript-view.ts`. The prose-then-calls step that antigravity and grok shared is
`proseThenCallRows`. Each agent still decides how its arguments become text (trimmed or not), so
the rows are unchanged.

## Library memory routes, Library back button, usage retrospective headers

- `/api/library/memory` and `/api/library/memory-health` share `mountProjectsRead`.
- The narrow-screen back button of the four Library readers is `LibraryBackButton.vue`.
- The cost / conversations / PRs headers of two retrospective tables come from one list.

## Verification

- Behaviour preservation: the old readers and renderers were run beside the new ones over generated
  records and compared whole; two deliberately broken variants were caught by the same comparison.
  The generator and the newest-prompt property live on in `exchange-fold.spec.ts`.
- `jscpd` at the workflow's version and flags reports the base clones and none after the change.
