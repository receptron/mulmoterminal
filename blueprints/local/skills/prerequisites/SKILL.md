---
name: blueprint-local-prerequisites
description: "Check Node (a version with node:sqlite) and yarn are available."
---

# Tools

This step carries the **review** gate: the user has read the spec and approved it.

1. Run the base manifest's `requires` probes. If Node is older than 22.13, tell the user in one plain sentence
   and give the install hint; do not upgrade Node yourself.
2. Nothing needs signing in. There is no cloud account in this blueprint.

Done when the check passes: `node:sqlite` opens a database.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
