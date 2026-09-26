---
name: blueprint-product-features
description: "Build the spec's must-haves on Firebase: the screens and client logic, working inside the Firestore rules, proven against the emulators."
---

# Features on Firebase

The skeleton, sign-in and the collections with their rules already exist. This step builds what the product DOES.

1. The screens in the spec, no more: Vue 3, the Firebase Web SDK against the emulators in development. Every
   error Firestore returns (a rule refusing a write, above all) is shown to the user in words.
2. Writes the client makes must fit the rules the data-rules step wrote. If a feature needs a write the rules do
   not allow, change the rules deliberately — the smallest opening that makes the feature work — and extend
   `test/blueprint/rules.spec.ts` in both directions for it. Never widen a rule to `if true` or to any signed-in
   user when the spec says only the owner.
3. Anything a client must not be trusted to do (counting likes, fan-out to followers' timelines, removing
   someone else's content as a moderator) is a Cloud Function, not a client write.
4. `test/blueprint/features.spec.ts`: each screen's main action works against the emulators as a signed-in user.

Done when the check passes: `emulator-test.sh features`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
