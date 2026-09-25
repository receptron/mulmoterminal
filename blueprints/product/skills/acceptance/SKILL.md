---
name: blueprint-product-acceptance
description: "Prove each must-have from the spec works end to end, one test per must-have."
---

# Must-haves, proven

The spec numbers the must-haves. For EACH one:

1. Write a test in `test/acceptance.test.ts` named after it (`must-have 1: …`) that walks the real flow through the
   API on a temporary database — create what it needs, do the action, and read back the result the user would see.
2. If a must-have does not work yet, make it work — this step is where gaps between the spec and the app close.
3. If a must-have cannot be tested through the API (it is purely visual), test the screen instead and say so in a
   comment on the test.

Do not add features that are not must-haves.

Done when the check passes: `test/acceptance.test.ts` exists, `yarn build` and `yarn test` succeed.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
