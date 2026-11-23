# feat: the mothership skill, issue to merge (#3409, part B)

Part B of #3409. A bundled skill, `mulmoterminal-issue-to-merge`, that walks the author session through
the flow #3403 describes, on top of part A's `requestReview` / `endReview` (#3410) and #3407's
`reviewSettings`.

## Steps the skill gives

1. Read the issue, the repository's own instructions, and `reviewSettings`. No `review` declared:
   ask the user (add `"review": {}`, or no loop) — never pick a reviewer.
2. Ask only what is open (`AskUserQuestion`, or `mulmoterminal-html-plan`), with assumptions stated.
3. Implement on a branch from an up-to-date default branch, the repository's checks green, a PR.
4. Spawn the declared reviewer once per PR; `requestReview`; act on the typed result (fix all and
   push / ask again / wait for CI); stop for the user at the round limit or a repeated finding.
5. Merge only on "Merge condition met" with CI re-checked; a blocked merge is reported, not routed
   around. `endReview`.

## Decisions

- The repository's own rules win over the skill's defaults (merge method, branch names, plan files).
- Not a settings skill: listed with the other non-settings skills in the router spec.
- The review tools are on the all-tools MCP url only, so the skill says to run from the workspace cell.
