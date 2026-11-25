# test: realContainedWithin.property.spec lists only inside its own tree (#3504)

## Problem

Some seeds (6, 26, 34) took 10-54 s locally against the 15 s timeout. Nearly all of it was
`probeTree` gathering candidates: a generated link spelled `<another link>/../…` leads, as the OS
follows it, out of the test's tree up to the system temp folder, and the spec listed every child of
it and their children — 200k+ entries on a developer machine, almost none on CI.

## Fix

Gather a folder's children only when its real location is inside the tree. Both the folder and the
top are resolved with `realpathSync.native`:

- the JS `realpathSync` cancels a target's `<link>/..` on paper, so it answered "inside" for the very
  link the OS followed out (measured: it named the tree's `root`, while `readdir` listed the temp
  folder's 207k entries);
- the top goes through `.native` too, so on Windows both sides of the comparison have the same
  spelling (short `RUNNER~1` names), or nothing would be listed and coverage would shrink silently.

A path that leads out is still a candidate to query — only its children are not gathered.

## Verification

- Per-seed time, all 40 seeds: before max 54 s, median ~0.1 s; after max ~0.1 s.
- Coverage kept, measured against the old spec with the product broken two ways:
  containment made lexical (no links followed) — 40/40 seeds fail, old and new;
  resolution through the JS `realpathSync` — 1/40 fail, old and new.
- Candidates per tree stay non-empty (~35 on macOS).
