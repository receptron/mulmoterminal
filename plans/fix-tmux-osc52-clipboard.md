# fix: OSC 52 clipboard (Claude auto-copy) swallowed by tmux in grid terminals

## Context

Proactive audit after the grid-scroll fix (#214): "他に tmux の影響はない?" — check what
else the #197 tmux wrapping regressed.

## Finding

Grid terminals run inside tmux. When a program (Claude Code) emits **OSC 52** to copy a
selection to the system clipboard, tmux intercepts it and, with its default
`set-clipboard external` and no `Ms` capability for the outer terminal, **does not forward
it** to the outer web terminal. So the ClipboardAddon (#206) never sees it → Claude's
auto-copy silently doesn't reach the browser clipboard. Verified: OSC 52 emitted inside
our tmux config does NOT reach the outer pty.

(Also checked and OK: truecolor 24-bit is preserved through tmux; `default-terminal` is
`tmux-256color`.)

## Fix (`server/tmux.ts`)

- `set -g set-clipboard on`
- `set -ag terminal-overrides ",*:Ms=\E]52;%p1%s;%p2%s\007"` — declare that the outer web
  terminal supports OSC 52 (its terminfo doesn't), so tmux forwards it. Appended so the
  built-in `linux*:AX@` override survives.
- Extracted the live-apply into `applyLiveTmuxOptions()` (mouse + set-clipboard +
  Ms-if-absent), so an already-running server (persisted sessions) gets it without a
  restart. Idempotent across node restarts.

## Verification

- OSC 52 now reaches the outer pty with the fix (both fresh config and live-applied to a
  running server) — verified via node-pty.
- Applied live to the running server; `set-clipboard on` + the Ms override are present,
  default override preserved, no duplication.
- `format`/`lint`/`typecheck`/`typecheck:server`/`build`/`test` green; added a regression
  test asserting the config forwards OSC 52.
