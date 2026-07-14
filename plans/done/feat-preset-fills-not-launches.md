# feat: preset dir click fills the field (+ shows sessions) instead of launching

Issue: receptron/mulmoterminal#360

## Problem

In the grid new-terminal launch form (`TerminalCell.vue`, empty-cell state), clicking a
directory **preset chip** immediately started a fresh session in that dir (`cell-chip-main`
→ `selectPreset` → `launchIn`). The user had no chance to pick an existing session to
resume (or the agent / a worktree / a script) first. The fill-without-launching behavior
existed only on a small secondary ✎ button (`cell-chip-fill` → `fillDir`), easy to miss.

## Decision (user-chosen)

Swap the chip's two actions; keep a one-click quick-launch as a secondary button:
- **Main click** → `fillDir`: fill the working-directory field WITHOUT launching, and load
  the resume ("or resume here") / scripts / worktrees for that dir — the requested default.
- **Secondary ▶ button** (was the ✎ fill button; class `cell-chip-fill` → `cell-chip-launch`,
  icon `edit` → `play_arrow`) → `selectPreset`: the one-click quick launch, preserved.
- **✕** delete button unchanged.

The running-session warning (`isCwdRunning`) moves to the ▶ launch button (the risky action);
the main button's title is just the path.

## Files (client-only — no server change)

- `src/components/TerminalCell.vue`: swap the two chip buttons' handlers; rename class + icon;
  move the running-session title to the launch button; update the `selectPreset` / `fillDir`
  role comments; rename `.cell-chip-fill` → `.cell-chip-launch` in `<style>`.
- `src/components/TerminalCell.spec.ts`: main click now fills (no launch); the ▶ button
  launches; the out-of-order test clicks the main button (now `fillDir`).

## Acceptance

- Clicking a preset chip fills the dir field and shows the resume list — no launch.
- The chip's ▶ button still one-click launches a fresh session.
- Gates green (format / lint / typecheck / build / test).
