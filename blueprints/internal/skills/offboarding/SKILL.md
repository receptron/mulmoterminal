---
name: blueprint-internal-offboarding
description: "Lock a leaver out at once: revoke refresh tokens, drop claims, disable the user, and make the rules refuse old tokens."
---

# Offboarding

1. A callable function `offboard({ uid })`, admin only, declared `onCall({ enforceAppCheck: true }, …)` with that option first and on the `onCall(` line (the protect check reads it line by line): `updateUser(uid, { disabled: true })`, set custom claims to
   `{}`, `revokeRefreshTokens(uid)`, then fetch the user AGAIN with `getUser(uid)` — the record you had is from
   before the revocation — and write `revocations/{uid}` with
   `revokedAtSec = Math.floor(new Date(user.tokensValidAfterTime).getTime() / 1000)`, and an audit entry.
   `auth_time` in the rules is in seconds; a value in milliseconds would lock out everyone or no one.
2. The rules' `notRevoked()` (already in the internal rules) refuses any token whose `auth_time` is not after that.
3. If the spec says offboarding need not be immediate, still ship the function — it is the only way to remove access
   before tokens expire — but it need not be on the admin screen.
4. Write `test/blueprint/offboarding.spec.ts`: after `offboard`, a token issued before it is refused by the rules and
   the user cannot sign in again.

Done when the check passes: `emulator-test.sh offboarding`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
