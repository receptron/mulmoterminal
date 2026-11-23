# feat: a repository's review settings, declared and readable (#3407)

Child 2 of #3403. A repository says how its PRs are reviewed, and the session that drives a review
can read it.

## The key

```json
{ "review": { "reviewer": "codex", "maxRounds": 10, "requiredLgtm": 1 } }
```

- `reviewer`: any hosted agent but muse (its replies cannot be read back, #3375). `REVIEWER_AGENTS`
  in `common/reviewSettings.ts`.
- `maxRounds`: rounds before a person is asked.
- `requiredLgtm`: LGTMs naming the current head that make a PR mergeable. CI passing is always
  required on top, so it is not an option.
- Omitted fields take `REVIEW_DEFAULTS`; `{}` is all defaults.
- **All or nothing.** Any wrong field, or a field name it does not know, drops the block
  (`dirReviewField`), so a typo never becomes a default the author did not pick. The key then shows as ignored in Settings.

## Reading it

`reviewSettings { repo }` (host tool, ungrouped like the #3404 tools). Keyed by repository, not by
the caller's directory: the session driving a review works on issues of any repository. The clone
is the one work starts in without asking — the recorded choice, else the first candidate
(`defaultCloneOf`), resolved through the same `repoDirsFromPresets` the issue start uses.

## Where it shows and travels

- Settings → Directory settings preview: a **Review** row.
- Not in the Settings form, on purpose (like `mobileFiles`): it decides which agent reviews and when a
  PR counts as mergeable, so it belongs in the file a reviewer of the repository sees.
- Inherited by managed worktrees: it describes the project, whichever tree a PR comes from.
- Documented in `mulmoterminal-config` (which owns the other file-only key) and the config guide.

## Deferred to child 3

- Generalising the verdict line beyond `CODEX VERDICT:` — the board labels it "Codex", and who writes
  the verdict (reviewer or driving session) is decided there.
- Showing "merge condition met" on the board.
