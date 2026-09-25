---
name: blueprint-local-auth
description: "Add the sign-in the spec asks for; with none, keep the app reachable from this computer only."
---

# Sign-in

Read the spec's sign-in choice.

- **None**: keep `HOST` at `127.0.0.1` and say so on the main screen's footer. `test/auth.test.ts` proves the
  server's default host is 127.0.0.1.
- **One shared password**: a sign-in screen; the password's scrypt hash in `.env`; a signed, HttpOnly session
  cookie; every `/api` route except `/api/health` and sign-in refuses without it.
- **One account per person**: a `users` table (scrypt hash with a per-user salt), sign-in and sign-out, roles if
  the spec lists them, checked on the server for every route.

`test/auth.test.ts`: a request without a session is refused, with one it passes; a wrong password is refused.

Done when the check passes: `yarn build` and `yarn test` succeed and `test/` has the auth tests.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
