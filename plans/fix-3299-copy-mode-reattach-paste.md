# fix #3299: a reattach during tmux copy-mode breaks bracketed paste

## Problem

Two independent causes, both from the issue and both checked against the code.

1. **A leaked DECRQM reply.** `stripTerminalQueries` removes the queries baked into a reattach replay so
   xterm does not answer them again, but it missed DECRQM (`CSI ? 2026 $ p`). xterm's reply
   `CSI ? 2026 ; 2 $ y` is sent as input; in copy-mode tmux reads it as keys, and under
   `mode-keys vi` its `?` opens an invisible (status off) search prompt. "Back to input"
   (`send-keys -X cancel`) leaves the prompt open, and it eats the next paste's `ESC [200~` and
   first line.
2. **Mode 2004 not restored on leaving copy-mode.** tmux reports `bracket_paste_flag` as 0 while the
   pane is in copy-mode, so a reattach then (with the startup `?2004h` pushed out of the 1 MiB
   replay) restores the browser without bracketed paste, and leaving copy-mode emits nothing that
   turns it back on.

## Fix

1. `QUERY_PATTERNS` covers every query xterm answers, not only the ones seen so far: DECRQM (ANSI
   and DEC private), DECRQSS, OSC 4 queries, and chained OSC 10/11/12 queries. A spec feeds each
   CSI/DCS query through `@xterm/headless` and asserts it is answered raw and not once stripped;
   near misses (DECSET, replies, soft reset, colour SETs) are pinned as kept.
2. `createPaneModePublisher` (`server/session/pty/pane-mode-publish.ts`): when the pane-mode watch
   publishes "left copy-mode", it also sends `bracketedPasteSequence(tmuxTerminalModes(id))` —
   `?2004h` or `?2004l`, matching tmux. Hooked on the published transition rather than on the
   "Back to input" button, so every way out of copy-mode (button, `q`, scrolling to the bottom)
   resyncs. Only 2004: re-asserting 1049 would clear the alternate screen.

## Not done

- Closing a search prompt that is already open. With the replies stripped nothing opens one; a
  `send-keys Escape` after `cancel` would be a second line of defence but needs measuring on tmux.
- CSI `t` window reports: xterm answers them only with `windowOptions` enabled, which this app
  does not set.
