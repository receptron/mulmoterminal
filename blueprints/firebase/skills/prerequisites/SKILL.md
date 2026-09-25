---
name: blueprint-firebase-prerequisites
description: "Check and install the tools a Firebase blueprint needs, and get the user signed in to Firebase and Google Cloud."
---

# Tools and sign-in

The user is not an engineer. Explain each thing you install in one plain sentence.

1. For every entry in `requires` of the base manifest, run its `probe`. Install what is missing using its `installHint`.
   The emulators need **JDK 21 or later**; an older `java` on PATH does not count. On macOS
   `brew install openjdk@21` is enough — the checks find it without changing the user's default `java`.
2. Firebase and gcloud must be signed in to the **same** account: the checks use both. If they differ, ask
   which account to use.
3. Sign-in is the **credential** gate: the executor has already asked the user to approve it. Run `firebase login` and
   `gcloud auth login` in the terminal and tell the user a browser window will open. Never ask the user to paste a
   password, token or key into the chat.
4. Never create or download a service-account key. Nothing in this blueprint needs one on this machine.

Done when the check passes: every tool answers, a JDK 21+ is found, and Firebase and gcloud are signed in to
the same account with a live session.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Never enable billing, deploy to production, delete data or handle a credential unless this step's gates say the
  user approved exactly that.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
