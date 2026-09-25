---
name: blueprint-local-spec
description: "Write .blueprint/spec.md from the interview answers and the base and usecase spec templates, and list what is still undecided."
---

# Write the specification

The answers are in `.blueprint/answers.json`; the prompt names both pack directories.

1. Start from the base pack's `spec/overview.md`, then the usecase pack's `spec/requirements.md`, in that order,
   in one file: `.blueprint/spec.md`. Fill every `{{…}}` from the answers.
2. The tables, API and screens are NOT asked directly — derive them from what the product is for, who uses it,
   what it handles and what they do. Write them as concrete tables and lists, each marked `（提案）`, small enough
   to build in one pass: the must-haves, nothing else.
3. Something the answers do not settle is not guessed: write "未定" and add a line to
   `.blueprint/open-questions.md` saying what is needed and why it matters.
4. Append both packs' `security/` checklists under a heading "必ず詰める点", unchanged.
5. Write in the language the user answered in. Nothing is built in this step; the next step stops for the user
   to read this spec.

Done when the check passes: `.blueprint/spec.md` exists and no `{{` placeholder is left in it.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
