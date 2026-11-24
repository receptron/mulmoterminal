# feat: a bundled review skill, and a repository that names its own (#3425, part A)

## Why

The reviewer in the review loop (#3409) was told how to review by one fixed sentence the server
builds. Nothing shipped told it more, and a repository could not ask for its own way of reviewing.

## What

- `server/skills/mulmoterminal-review/SKILL.md`, bundled (`BUNDLED_SKILL_NAMES`). The reviewer's
  side of the loop, modelled on the codex-cross-review protocol: one complete round per request;
  each finding with severity, `file:line`, every other site, the smallest change and what would
  change the reviewer's mind; prove what can be run before judging it, and mark the rest
  UNVERIFIED; depth by how risky the change is; every axis answered, "none" included; later rounds
  check earlier findings and say REOPENING rather than repeat; the verdict line first and a
  FINDINGS COMPLETE line last; the same reply posted on the PR.
- `review.skill` in `.mulmoterminal.json`: a skill name or `plugin:name`, default
  `mulmoterminal-review`. Validated like the rest of the block — a bad name drops the whole key.
  It must not hold a space or a line break, because it is written into the one-line request.
- `reviewPrompt` names the skill. The verdict line and the PR comment stay in the server's request
  and win over the skill, since the rounds are counted by them.
- `reviewSettings` says which skill; the Settings summary shows it.

## Not here

Parts B (the reviewer started by the server on the PR's head, with network for codex) and C (a
reviewer stopped on the user is told to the author) are separate PRs.
