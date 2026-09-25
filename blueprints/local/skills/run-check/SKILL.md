---
name: blueprint-local-run-check
description: "Build for production, start it, and make sure the screen and the API answer."
---

# Start it for real

1. `yarn build`, then run what `yarn start` runs, on a spare port, and open `/` and `/api/health`.
2. Fix anything that only breaks in the built version (paths to dist/client, the database folder not existing).

Done when the check passes: the built server starts, `/api/health` answers ok, and `/` serves the app.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
