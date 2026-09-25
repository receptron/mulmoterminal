---
name: blueprint-internal-production-auth
description: "Put the sign-in restriction live on production before the site is: deploy functions and rules only, then register the blocking functions."
---

# Production sign-in restriction first

This step carries the **deploy-production** gate; the user approved it. It deploys only the back end, so that
when the site is published in the next step the domain restriction is already enforced.

1. `firebase deploy --project prod --only functions,firestore`. Do NOT deploy hosting here.
2. Make sure the production project is on Identity Platform, then register `beforeUserCreated` and
   `beforeUserSignedIn` under Authentication > Settings > Blocking functions. Give the user the URL and wait.
3. There is nothing for the user to try yet — the site is not published. The check reads the registration from
   the project itself.

Done when the check passes: the production project's Identity Toolkit config lists both blocking triggers.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
