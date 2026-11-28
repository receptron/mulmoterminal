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
  - whether a process is this run's launcher, or this scratch HOME's server;
  - which process group `stop` may signal, and when tmux may be stopped;
  - whether `dist/` is older than `src/`;
  - the supported platforms (macOS, Linux).
- CLAUDE.md's tmux section points at the skill instead of describing the manual way.
- `eslint.config.js`: `scripts/verify-scratch.ts` and the skill's drive script join `bin/` in
  `sonarjs/no-os-command-from-path: off`. They run the user's installed `tmux`, `ps` and `lsof`, which
  have no portable absolute path. The drive script also gets Node globals.

## Decisions

- **The socket is computed, never listed.** The server derives it from `realpath(HOME)`, so the
  helper does the same, through the same function. `stop` compares the path for equality, and refuses
  everything else: the live socket, another scratch HOME's socket, a bare name.
  - To make the two computations agree, the server is given the absolute real `$H`, and its
    environment drops `TMUX_TMPDIR` (Codex round 1: a relative HOME or TMUX_TMPDIR made them diverge).
- **A process is signalled only when it is identified, never because a file names it** (Codex
  round 1: the state file chose both the pid and the checkout).
  - The launcher must have the start time recorded at spawn, a command that is either the recorded
    one or its `mulmoterminal :<port>` title, and stdout on `$H/server.log`.
  - The server must be in an entry under `$H/.mulmoterminal/instances/`, in the launcher's process
    group, with stdout on that log.
  - The log is what binds a process to this run: `start` opened it, and the live server writes to its
    terminal.
  - HOME was tried first and fails on macOS. The launcher renames itself, and that overwrites the
    environment `ps -E` shows.
  - The launcher's facts are recorded only once its command is the launcher script. Right after spawn,
    `ps` still shows the parent's command.
- **Stop order: signal, wait, force, then tmux.** `stop` sends SIGTERM to the group, waits for the port
  to go quiet, and sends SIGKILL if it does not. It stops tmux only once nothing answers. If `start`
  gives up waiting for the server, it stops what it spawned.
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

Then run the skill end to end on a fresh scratch HOME:

- the normal path: start → doctor → drive-shell → capture-pane shows the marker → stop;
- the launcher killed with SIGKILL while its server runs: `stop` must find the server through the
  instance entry and stop it;
- the refusals: `start --home "$HOME"`, and `stop` on a directory the helper never started.

In every case, `tmux -S <socket dir>/mulmoterminal ls` must list the same sessions before and after.
A state file forged to name the LIVE launcher is covered by the spec only. Running `stop` against the
real one is exactly the risk this helper exists to remove.
