---
name: blueprint-local-ui
description: "Build the spec's screens in Vue and wire them to the API."
---

# Screens

1. The screens in the spec, no more. Vue 3 Composition API, plain and readable; a list, a form, a detail as
   needed. Every error the API returns is shown to the user in words, not swallowed.
2. Text in the language the spec says.
3. `test/ui.test.ts`: mount the main screens with the API mocked, and check the main action works (a list shows
   rows, a form submits).

Done when the check passes: `yarn build` and `yarn test` succeed and `test/` has the ui tests.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
