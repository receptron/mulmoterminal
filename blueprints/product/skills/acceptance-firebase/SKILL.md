---
name: blueprint-product-acceptance
description: "Prove each must-have from the spec works end to end against the emulators, as the users the spec names — and fails for everyone it should fail for."
---

# Must-haves, proven on Firebase

The spec numbers the must-haves. For EACH one, in `test/blueprint/acceptance.spec.ts`, name the test after it
(`must-have 1: …`):

1. Walk the real flow against the emulators as a signed-in user: create what it needs, do the action, and read
   back what the user would see.
2. Then the refusal: the same action by someone who must not be able to do it (another user, a signed-out
   visitor) is refused by the rules.
3. If a must-have does not work yet, make it work — this step is where gaps between the spec and the app close.

Do not add features that are not must-haves.

Done when the check passes: `emulator-test.sh acceptance`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
