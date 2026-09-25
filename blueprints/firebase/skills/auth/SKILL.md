---
name: blueprint-firebase-auth
description: "Add Google sign-in to the app and prove it against the Auth emulator."
---

# Sign-in

1. Google sign-in with `signInWithPopup` (fall back to redirect on mobile).
2. Point the app at the Auth emulator when `import.meta.env.DEV` is set.
3. A signed-out user sees only the sign-in screen.
4. Write `test/blueprint/auth.spec.ts`: a signed-in context can read what the rules allow a member, an
   unauthenticated context cannot.

Done when the check passes: `emulator-test.sh auth`.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
