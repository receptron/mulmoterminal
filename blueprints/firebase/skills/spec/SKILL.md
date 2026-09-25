---
name: blueprint-firebase-spec
description: "Write .blueprint/spec.md from the interview answers and the base and usecase spec templates, and list what is still undecided."
---

# Write the specification

The user answered an interview; the answers are in `.blueprint/answers.json`. The prompt names the two pack
directories.

1. Start from the base pack's `spec/overview.md`, then the usecase pack's `spec/requirements.md`, in that order,
   in one file: `.blueprint/spec.md`. Fill every `{{…}}` from the answers.
2. A placeholder the answers do not settle is NOT guessed: write "未定" in its place and add a line to
   `.blueprint/open-questions.md` saying what is needed and why it matters. Where the answers settle it only by
   implication (the collections from `appPurpose`, for example), write your proposal and mark it `（提案）`.
3. Append both packs' `security/` checklists under a heading "必ず詰める点", unchanged — they are what the later
   steps are held to.
4. Write in the language the user answered in.
5. Nothing else is built in this step. The next step stops for the user to read this spec before anything is
   created in their cloud account.

Done when the check passes: `.blueprint/spec.md` exists and no `{{` placeholder is left in it.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
