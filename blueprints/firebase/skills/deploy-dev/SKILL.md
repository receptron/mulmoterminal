---
name: blueprint-firebase-deploy-dev
description: "Deploy rules, indexes, functions and hosting to the dev project."
---

# Publish to dev

1. `yarn build`, then `git rev-parse HEAD > dist/blueprint-build.txt`, then `firebase deploy --project dev`.
   Commit first: the check compares the deployed marker with `HEAD`, so it proves THIS build is live.
2. Tell the user the URL (`https://<dev-project-id>.web.app`) and what to try there.

Never deploy to `prod` in this step.

Done when the check passes: the dev site serves the marker of the current commit.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
