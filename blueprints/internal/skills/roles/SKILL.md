---
name: blueprint-internal-roles
description: "Roles in custom claims, granted only by an admin-only callable function; the first admin by a one-off script."
---

# Roles and permissions

1. Roles are the ones in the spec. Store them as `roles: string[]` in custom claims.
2. A callable function `setRoles({ uid, roles })`, declared `onCall({ enforceAppCheck: true }, …)` with that option first and on the `onCall(` line (the protect check reads it line by line): refuses unless the CALLER's token has `admin`, refuses unknown
   roles, sets the claims, writes an audit entry (see audit-log), and returns.
3. The first admin: `scripts/grant-first-admin.ts`, run once by the user with their own gcloud credentials
   (`GOOGLE_APPLICATION_CREDENTIALS` is NOT needed — use Application Default Credentials). Do not expose it as a
   function.
4. Update the collection rules from the spec's role table to use `hasRole(...)`.
5. Write `test/blueprint/roles.spec.ts`: a non-admin calling `setRoles` is refused; an admin succeeds; each role
   can do exactly what its row of the table says, in both directions.

Done when the check passes: `emulator-test.sh roles`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
