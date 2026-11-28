# feat: a skill for verifying a change in a running MulmoTerminal (#3593)

## Problem

CLAUDE.md asks for a running app whenever a change has a wide blast radius, but how to run one here
was prose spread over CLAUDE.md's tmux section and a private memory. Each verification rebuilt it from
scratch. The step that goes wrong, cleanup, has stopped the maintainer's live tmux server more than
once.

## Change

- `.claude/skills/verify-mulmoterminal/SKILL.md` is the procedure, in five sections: launch, doctor,
  drive, evidence, cleanup. `drive-shell.mjs` opens a Shell cell, types a marker and takes a
  screenshot.
- `scripts/verify-scratch.ts` (`start` / `doctor` / `stop`) does the I/O that can go wrong.
  `scripts/verify-scratch-plan.ts` holds the decisions as pure functions, pinned by
  `test/scripts/verify-scratch-plan.spec.ts`:
  - the scratch socket path, computed with the server's own `homeScopeSuffix`;
  - the only socket `stop` may kill;
  - whether `dist/` is older than `src/`.
- CLAUDE.md's tmux section points at the skill instead of describing the manual way.
- `eslint.config.js`: `scripts/verify-scratch.ts` joins `bin/` in `sonarjs/no-os-command-from-path: off`.
  It runs the user's installed `tmux` and `lsof`, which have no portable absolute path.

## Decisions

- **The socket is computed, never listed.** The server derives it from `realpath(HOME)`, so the
  helper does the same, through the same function. `stop` compares the path for equality, and refuses
  everything else: the live socket, another scratch HOME's socket, a bare name.
- **A socket file can outlive its server** (seen in the first run). Running is therefore judged by
  `tmux -S <path> list-sessions`, not by whether the file exists.
- **`start` refuses a stale `dist/`.** In the first run, the checkout's `dist/` predated `src/`. The
  launcher would have served the old page.
- **The launcher is not `yarn dev`.** Dev uses fixed ports that sibling checkouts hold. The launcher
  is started with an explicit `--port` instead, and `start` refuses a port that already answers.
- **The account-home check comes before anything is written.** Otherwise `prepareHome` could create
  `~/work` and `~/.zshrc` before the refusal.
- **`start` writes `$H/.zshrc` with a short prompt**, because the first run's screenshot showed the
  account name and host.
- **No Playwright dependency is added.** The drive script takes a directory holding an installed
  Playwright. Adding one to this repo is a separate decision.
- **Shell cells only.** Agents under a scratch HOME misbehave (codex self-updates, claude cannot log
  in).
- **Out of scope:** a generator for other repositories, shipping this as a bundled skill, and having
  the review loop call it.

## Verify

Commands:

- `yarn test test/scripts/verify-scratch-plan.spec.ts`
- the repo's format, lint, typecheck and build

Then run the skill end to end on a fresh scratch HOME: start → doctor → drive-shell → capture-pane
shows the marker → stop. Check that `tmux -S <socket dir>/mulmoterminal ls` lists the same sessions
before and after. Also run the refusals: `start --home "$HOME"`, and `stop` on a directory the helper
never started.
