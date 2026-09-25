---
name: blueprint-local-data
description: "Turn the spec's tables into SQLite migrations with node:sqlite, and prove them with tests."
---

# Data

1. One migration file per change in `server/migrations/`, applied by `server/db.ts` on start. Primary keys,
   NOT NULL and UNIQUE as the spec's table says; foreign keys with `PRAGMA foreign_keys = ON`.
2. A small data-access module per table with parameterised statements only (`db.prepare("… ?").run(value)`).
3. `test/data.test.ts`: against a temporary database, every table can be written and read back, every NOT NULL
   and UNIQUE is refused when broken, and running the migrations twice changes nothing.

Done when the check passes: `yarn build` and `yarn test` succeed and `test/` has the data tests.

## Always

- Read `.blueprint/spec.md` first. It is the agreed specification; do not widen it.
- When you need a decision, ask it through the blueprint question tool and stop. Do not guess.
- Do not run `git init`: a new repository loses the folder's trust and the next unattended step stops at Claude
  Code's trust prompt. The user adds git themselves after the build if they want it.
- Say you are done by stopping; the executor runs the check. Do not claim success yourself.
