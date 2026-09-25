---
name: blueprint-local-handover
description: "Write the README the user needs: how to start it, where the data is, and how to back it up."
---

# Handover

Write `README.md` in the spec's language, for someone who is not an engineer:

1. What the app does, in two sentences.
2. How to start it: `yarn install` once, then `yarn build` and `yarn start`, then the address to open.
3. Where the data is (`data/app.db`) and how to back it up: stop the app, copy the file. How to restore it.
4. Who can open it (this computer only, or with a password) and how to change that.

Done when the check passes: `README.md` exists and explains `yarn start` and the backup of `data/app.db`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
