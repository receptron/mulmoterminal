# Restore bracketed paste after a reconnect (#2990)

The reattach replay is a bounded tail, so a mode a program sets once at startup falls off its front.
The modes read back from tmux and sent ahead of it (`TERMINAL_MODE_FLAGS`) covered the screen buffer and
the mouse but not bracketed paste (2004), so a multi-line paste after a reload reached the program as
bare CRs.

- Add `bracket_paste_flag` to the table. Ask tmux, as for every other mode.
- tmux added that variable in 3.7; an older one renders it empty, which parses as off. We support the
  latest tmux release only, so no fallback is built (the byte-stream tracker that non-tmux sessions use
  was considered and left out).
- The README, the getting-started pages (en/ja), `docs/facts.json` and the bug-report skill name the
  latest release (the version and the date it was checked).
