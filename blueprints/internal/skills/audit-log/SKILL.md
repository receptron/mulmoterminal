---
name: blueprint-internal-audit-log
description: "Record every privileged action in a collection only functions can write and only admins can read."
---

# Audit log

1. A helper in `functions/` that writes `auditLogs/{autoId}`: `{ actorUid, actorEmail, action, targetUid?, detail,
   at: FieldValue.serverTimestamp() }`. Every privileged function calls it (setRoles, offboard, and any action the
   spec lists).
2. The rules already deny all client writes to `auditLogs` and let only admins read.
3. Write `test/blueprint/audit.spec.ts`: calling `setRoles` produces an entry; a client write to `auditLogs` is
   refused for every role including admin; a non-admin cannot read it.

Done when the check passes: `emulator-test.sh audit`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
