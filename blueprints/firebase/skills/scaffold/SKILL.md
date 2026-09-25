---
name: blueprint-firebase-scaffold
description: "Create the app skeleton: web app, Cloud Functions workspace, emulator config and the rules test harness."
---

# App skeleton

1. Web app: Vite + TypeScript (Vue unless the spec says otherwise). Use `yarn`.
2. `firebase init` for Hosting, Firestore, Functions (TypeScript) and Emulators (Auth, Firestore, Functions,
   Hosting). Copy `infra/firestore.rules`, `infra/firestore.indexes.json` and `infra/firebase.json` from the base
   pack over what init wrote, then merge in anything init generated that they lack.
3. Test harness for rules and functions: `test/blueprint/` with vitest and `@firebase/rules-unit-testing`.
   Every later step adds its own `test/blueprint/<name>.spec.ts`; `checks/emulator-test.sh <name>` runs exactly
   that file against the emulators under the `demo-blueprint` project id, so tests can never touch a real project.
4. `yarn build` must succeed.
5. Do NOT run `git init`. A new repository root loses the trust its parent folder gave it, and every later step
   would stop at Claude Code's trust prompt with nobody there to answer. If the user wants git, they add it
   themselves after the build.

Done when the check passes: `firebase.json` configures the emulators, `functions/` exists, `@firebase/rules-unit-testing`
is a dev dependency, `test/blueprint/` exists and `yarn build` succeeds.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
