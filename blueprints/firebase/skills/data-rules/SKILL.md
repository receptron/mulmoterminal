---
name: blueprint-firebase-data-rules
description: "Model the collections from the spec and open each one explicitly in firestore.rules, proven by emulator tests."
---

# Data model and security rules

The spec has a table per collection: who may read, create, update and delete. That table IS the rules.

1. For each collection, add a `match` block above the final deny-all. Open only what the table says.
2. On create, pin ownership (`request.resource.data.ownerUid == request.auth.uid`) and the fields a client may set
   (`request.resource.data.keys().hasOnly([...])`).
3. On update, forbid changing ownership and any field the table does not let that role change
   (`diff(resource.data).affectedKeys().hasOnly([...])`).
4. Write `test/blueprint/rules.spec.ts` with BOTH directions for every row of the table: the allowed operation
   succeeds (`assertSucceeds`) and every other role is refused (`assertFails`). A rule with only a success test is
   not tested.
5. If the table is ambiguous, ask — do not open more than it says.

Done when the check passes: `emulator-test.sh rules`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
