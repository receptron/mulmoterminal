---
name: blueprint-firebase-projects
description: "Create or choose the dev and production Firebase projects and put them on the Blaze plan."
---

# Dev and production projects

Read `.blueprint/spec.md` for `existingProject`, `existingProjectId` and `region`.

1. Two projects: dev and production. If the user named an existing one, use it for production and create only dev.
   Project ids are global — propose `<app>-dev` / `<app>-prod` and ask if they are taken.
2. `firebase projects:create <id>` for each new one, then write `.firebaserc` with aliases `dev` and `prod`
   (`firebase use --add`).
3. **Billing is the gate for this step** and the executor has already had it approved. Linking a billing account
   (Blaze) is done by the user in the console: give them the exact URL
   `https://console.firebase.google.com/project/<id>/usage/details` and wait for them to confirm. Do not try to
   link billing from the CLI on their behalf.
4. Create Firestore in `region` for BOTH projects. The region cannot be changed later — read it back from the spec,
   never assume a default.
5. Each project needs a registered web app — Hosting serves its config at `/__/firebase/init.json`, which the app
   reads. `firebase apps:list WEB --project <id>`; if none, `firebase apps:create WEB <app name> --project <id>`.

Done when the check passes: `.firebaserc` has distinct `dev` and `prod` projects, both exist, both have billing
enabled and both have a Firestore database.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
