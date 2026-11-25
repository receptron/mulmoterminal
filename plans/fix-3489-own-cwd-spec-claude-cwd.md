# test: session-route-own-cwd.spec no longer reads the host's CLAUDE_CWD (#3489)

## Problem

The spec moves HOME to a scratch directory before importing `server/config/env.ts` and expects
`CLAUDE_CWD` to be `<scratch HOME>/mulmoclaude`. `env.ts` prefers `process.env.CLAUDE_CWD`, which a
shell in a MulmoTerminal cell inherits from the server (`bin/cli-args.js`), so run from a cell the
spec read the host's workspace and `keeps the workspace` failed. CI sets nothing, so it never saw it.

## Fix

Clear `CLAUDE_CWD` right after `takeScratchHome(...)`, before the dynamic imports; restore it in
`afterAll` — the same save/restore as `workspace-cwd.spec.ts`.

## Scope

`CLAUDE_CWD` is the only variable `env.ts` lets override a HOME-derived value. Running the whole
suite with a foreign `CLAUDE_CWD` set failed only this spec because of it (two other files failed with
the variable unset too, so not because of it). `session-cwd-hydration.spec.ts` also uses a scratch
HOME but compares against the imported `CLAUDE_CWD`, so it holds either way.

Not changed: `takeScratchHome` itself. Clearing the variable there would cover future specs, but it
changes the environment of every spec using the helper; left for a separate decision.
