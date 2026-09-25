---
name: blueprint-local-api
description: "Expose the spec's operations as a validated JSON API under /api, with tests."
---

# API

1. One route per operation in the spec's API table. Validate every body and parameter at the entry (zod is fine)
   and answer 400 with a message when it is wrong; 404 for a missing row.
2. State-changing requests (POST/PUT/PATCH/DELETE) are refused unless they come from the same origin.
3. `test/api.test.ts`: every route in both directions — the valid request succeeds with the right body, an
   invalid one is refused with 400. Build the app on a temporary database.

Done when the check passes: `yarn build` and `yarn test` succeed and `test/` has the api tests.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
