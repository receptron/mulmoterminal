---
name: blueprint-internal-domain-restriction
description: "Limit sign-in to the company's email domain, twice: in blocking functions and in the rules."
---

# Company domain only

0. Blocking functions need the projects upgraded to **Firebase Authentication with Identity Platform**. Run
   `sh <usecase pack>/checks/identity-platform.sh dev prod` (with `BLUEPRINT_BASE` / `BLUEPRINT_USECASE` set to
   the two pack paths): it reads each project and names only the ones not upgraded yet. Ask the user only if it
   fails, giving them exactly the URLs it printed — the upgrade is free at this size, but it is a click only they
   can make.
1. In `functions/`, add `beforeUserCreated` and `beforeUserSignedIn` (from `firebase-functions/v2/identity`).
   Both throw `HttpsError("permission-denied")` unless `event.data.email` ends with `@<domain>` AND
   `event.data.emailVerified` is true. Compare lower-cased.
2. If the spec says Google Workspace, also pass `hd: <domain>` to the Google provider. That is a hint to the
   account picker, not a check — the functions are the check.
3. Copy `infra/firestore.rules` from the internal pack into the project, filling `{{DOMAIN_REGEX}}` with the
   domain in lower case with its dots escaped. First check the domain is only DNS labels
   (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$` after lower-casing); anything else
   — a `*`, a `|`, a space — could widen the rule, so ask instead of escaping it. Keep every collection already opened by the data-rules step.
4. A refused sign-in gets its own screen, not an error code. The blocking functions' refusal reaches the
   client as `auth/internal-error` whose message carries the `HttpsError` (look for `permission-denied` /
   `BLOCKING_FUNCTION_ERROR_RESPONSE`), so classify the error in a pure function of its own file
   (refused-by-domain / cancelled / popup-blocked / other) with a unit test for each kind. The refusal screen says
   in plain words that only `@<domain>` accounts can use this app, names the account that was refused when the
   error carries it, and offers a button that opens the account chooser again (`prompt: "select_account"`).
   Other failures say what happened in words; the raw code may follow in small text, never on its own.
5. Write `test/blueprint/domain.spec.ts`: a verified member of the domain is let in, also with an upper-case
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
