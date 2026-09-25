---
name: blueprint-firebase-deploy-production
description: "Deploy the same build to the production project."
---

# Publish to production

This is the **deploy-production** gate: the user has approved it. Deploy exactly what was verified on dev.

1. `yarn build`, then `git rev-parse HEAD > dist/blueprint-build.txt`, then `firebase deploy --project prod`.
   Commit first: the check compares the deployed marker with `HEAD`, so it proves THIS build is live.
2. Tell the user the URL and that the next change should go through dev first.

Done when the check passes: the production site serves the marker of the current commit.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
