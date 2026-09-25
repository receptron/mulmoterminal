---
name: blueprint-firebase-deploy-production
description: "Deploy the same build to the production project."
---

# Publish to production

This is the **deploy-production** gate: the user has approved it. Deploy the same source that was verified on dev — do not change anything between the two.

1. `yarn build`, then give this build an id and ship it with the site:
   `node -e 'console.log(require("crypto").randomUUID())' > .blueprint/build-id && cp .blueprint/build-id dist/blueprint-build.txt`,
   then `firebase deploy --project prod`. The check compares the served id with `.blueprint/build-id`, so it
   proves THIS build is live. Git is not needed for this.
2. Tell the user the URL and that the next change should go through dev first.

Done when the check passes: the production site serves the id this deploy wrote to `.blueprint/build-id`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
