# feat: `npx mulmoterminal init` — idempotent first-run setup

Issue: receptron/mulmoterminal#380

## Goal

One command that takes a new user from zero to a configured MulmoTerminal, safely
re-runnable (overwrites the managed parts, preserves user-set fields).

## What `init` does

1. **Preflight checks** (report ✓/✗/○ + guidance):
   - Node ≥ 22.9 (the engine requirement).
   - `claude` CLI — if missing, **print** `npm i -g @anthropic-ai/claude-code` (never auto-install, per the user's choice).
   - Optional: `tmux` / `gh` / `codex` — check + print install hints.
2. **Derive working-dir presets from Claude history** — scan `~/.claude/projects/`, read each
   project's newest transcript for its recorded `cwd` (the dir NAME can't be decoded — `/`, `.`,
   and literal `-` all encode to `-`), keep dirs that still exist, dedupe by path (newest mtime),
   rank by recency, take the top 10.
3. **Write / merge `~/.mulmoterminal/config.json`** — `mergeConfigUpdate(loadAppConfig(...),
   { cwdPresets })` + `saveAppConfig` (creates the dir, preserves `soundFile` / `launchers` / …).
4. **Offer interactive config** — if `claude` is installed, prompt to launch it on the existing
   `/mulmoterminal-config` skill.

Idempotent: re-running re-derives + overwrites `cwdPresets`; user fields survive.

## Layout (server/ was reorganized into role subdirs)

- `server/config/cwd-presets.ts`: add pure `extractCwdFromTranscript(raw)` + `deriveCwdPresets(records, exists, max)` (+ `CwdRecord`). Tests in `cwd-presets.spec.ts`.
- `server/cli-init.ts`: I/O orchestration (scan projects → records → derive → write config → print). Run via `tsx` from the bin. Reuses `app-config` (no CLI detection here → cleanly linted).
- `bin/mulmoterminal.js`: dispatch `init` — env/CLI checks (Node + claude/tmux/gh/codex, the existing PATH-command-detection exception) + report, spawn `cli-init.ts`, then the skill prompt + `claude` launch. `--help` updated.
- `README.md`: document `npx mulmoterminal init`.

## Acceptance

- `npx mulmoterminal init` prints the check report, sets `cwdPresets` from real Claude dirs, is re-runnable.
- Never writes a bogus preset (only existing dirs); never clobbers user config fields.
- Gates green (format / lint / typecheck / typecheck:server / build / test).
