---
name: blueprint-firebase-protect
description: "Turn on App Check for the app and put a budget alert on the production project."
---

# App Check and budget alert

1. App Check with reCAPTCHA Enterprise for the web app. Register the site key in both projects; call
   `initializeAppCheck` in the app. Every callable function is declared `onCall({ enforceAppCheck: true }, …)`. Turn on enforcement for Firestore and Functions in the console — give the user
   the URL and wait for them.
2. Budget alert (the **billing** gate, already approved): `gcloud billing budgets create` on the production
   project's billing account at the amount in the spec, alerting at 50%, 90% and 100%, with
   `--filter-projects=projects/<prod-project-id>` so it watches this project and not the whole account.

Done when the check passes: App Check is ENFORCED for Firestore on production, every callable enforces it, and a budget is scoped to the production project.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
