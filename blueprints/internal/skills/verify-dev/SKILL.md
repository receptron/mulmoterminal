---
name: blueprint-internal-verify-dev
description: "Confirm the company-domain blocking functions are registered and running on the dev project."
---

# Domain restriction on dev

1. Open Authentication > Settings > Blocking functions for the dev project and register `beforeUserCreated`
   and `beforeUserSignedIn`. If the console shows no such section, the project is not yet on Identity Platform —
   ask the user to upgrade it and wait.
2. Ask the user to try signing in with an account outside the company domain (a personal Gmail) and confirm it is
   refused.

Done when the check passes: the project's Identity Toolkit config lists both blocking triggers.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
