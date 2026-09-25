---
name: blueprint-internal-domain-restriction
description: "Limit sign-in to the company's email domain, twice: in blocking functions and in the rules."
---

# Company domain only

0. Blocking functions need the projects upgraded to **Firebase Authentication with Identity Platform** (console:
   Authentication > Settings). It is free at this size but it is an upgrade the user must click — give them the
   URL for each project and wait.
1. In `functions/`, add `beforeUserCreated` and `beforeUserSignedIn` (from `firebase-functions/v2/identity`).
   Both throw `HttpsError("permission-denied")` unless `event.data.email` ends with `@<domain>` AND
   `event.data.emailVerified` is true. Compare lower-cased.
2. If the spec says Google Workspace, also pass `hd: <domain>` to the Google provider. That is a hint to the
   account picker, not a check — the functions are the check.
3. Copy `infra/firestore.rules` from the internal pack into the project, filling `{{DOMAIN_REGEX}}` with the
   domain in lower case with its dots escaped. First check the domain is only DNS labels
   (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$` after lower-casing); anything else
   — a `*`, a `|`, a space — could widen the rule, so ask instead of escaping it. Keep every collection already opened by the data-rules step.
4. Write `test/blueprint/domain.spec.ts`: a verified member of the domain is let in, also with an upper-case
   address; another domain, an unverified address, and look-alikes (`example.co.jp.evil.com`,
   `evilexample.co.jp`, `@example.co.jp` with nothing before the `@`) are all refused.

The emulator proves the code, not the real projects: the functions only run once they are deployed AND
registered as blocking functions. The `verify-dev` and `production-auth` steps check that on each project.

Done when the check passes: `emulator-test.sh domain`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
