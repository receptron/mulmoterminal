---
name: blueprint-firebase-deploy-dev
description: "Deploy rules, indexes, functions and hosting to the dev project."
---

# Publish to dev

1. `yarn build`, then give this build an id and ship it with the site:
   `node -e 'console.log(require("crypto").randomUUID())' > .blueprint/build-id && cp .blueprint/build-id dist/blueprint-build.txt`,
   then `firebase deploy --project dev`. The check compares the served id with `.blueprint/build-id`, so it
   proves THIS build is live. Git is not needed for this.
2. Tell the user the URL (`https://<dev-project-id>.web.app`) and what to try there.

Never deploy to `prod` in this step.

Done when the check passes: the dev site serves the id this deploy wrote to `.blueprint/build-id`, serves a web
app config at `/__/firebase/init.json`, has Google sign-in switched on, and the page renders text in headless Chrome (a blank page fails).

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
