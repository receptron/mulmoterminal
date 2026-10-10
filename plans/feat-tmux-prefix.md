# tmux prefix key setting (#2981)

The dedicated tmux server kept tmux's default prefix `C-b`, which swallowed the first Ctrl+B in a cell
(it is "one character left" in readline, Claude Code and the macOS text system) and turned the next key
into a tmux command. Nothing in the app uses the prefix.

- `tmuxPrefix` in config.json: `none` (default), `C-b`, or Control plus one safe key. Invalid values fall
  back to `none`; the accepted set is narrow because the key is written into tmux conf lines.
- The commands are idempotent and used twice: appended to `tmux.conf` for a fresh server, and run live for
  a server that outlived the process, at boot and when the setting is saved.
- Settings -> Terminal keys has a dropdown; the keys skill, config guide and README document it.
- Not done: a start-up warning when a custom key overlaps cursor keys (the issue's optional extra).
