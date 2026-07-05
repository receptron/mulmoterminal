# fix: grid terminal 2-finger scroll cycles history instead of scrolling

## Symptom

In multi-terminal (grid) mode, 2-finger / wheel scroll no longer scrolls the terminal —
instead claude's input history cycles (↑/↓).

## Root cause

Not the OSC-52 clipboard PR (#206 — that only added `ClipboardAddon`, no scroll code).
The regression came from **#197 (tmux persistence)**: each grid pty now runs inside tmux.
Claude enables mouse tracking (`?1000h`/`?1003h`/`?1006h`), but our tmux config set no
mouse option, so tmux used its default `alternate-scroll on` — which, for a full-screen
app with mouse mode off, **converts the wheel into ↑/↓ arrow keys**. Claude receives
arrows → input-history cycling.

Verified: the grid session spawns "via tmux"; claude emits the mouse-tracking DECSETs;
`tmux -L mulmoterminal set -g mouse on` (applied live) fixes it (user-confirmed).

## Fix (`server/tmux.ts`)

Add `set -g mouse on` to the isolated server's config so tmux forwards the wheel to the
program (claude scrolls) — restoring the pre-tmux behavior. Because a tmux server already
running from persisted sessions ignores `-f` config on `new-session`, also apply the
option **live** (`set -g mouse on`) when a server is already up; it's a no-op otherwise
(the config file covers fresh starts).

- Extracted the config to an exported `TMUX_CONF_LINES` for a regression test.

## Verification

- `format`/`lint`/`typecheck`/`typecheck:server`/`build`/`test` green; added a test
  asserting `TMUX_CONF_LINES` contains `set -g mouse on`.
- Live-applied to the running server and the user confirmed 2-finger scroll works again.
