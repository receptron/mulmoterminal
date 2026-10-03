---
name: blueprint-style-report
description: "Report what became a machine rule, what went to the guide, and what was left out and why."
---

# Report

Write `.blueprint/style-report.md` for the person, in their language and in plain words:

- `## 機械の決まり` / `## Machine rules` — `chaff.yaml`: the genre and language, and each rule you set
  with its reason, in one line each. How to run it: `npx -y chaffjs@0.21 <file or folder>`.
- `## 手引き` / `## The guide` — what `STYLE.md` asks for that a machine cannot check.
- `## 規約にしなかったこと` / `## Left out` — what the models do that you did not make a rule, and why;
  any genre chaff lacked; any source that was converted from Word or PDF; counter texts chaff could not see.

Then tell the person where the two files are and that the next packs (writing and polishing documents)
use them.
