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
   and DEC private, any parameter count), DECRQSS, OSC 4 queries, and chained OSC 10/11/12 queries. A spec feeds each
   CSI/DCS query through `@xterm/headless` and asserts it is answered raw and not once stripped;
   near misses (DECSET, replies, soft reset, colour SETs) are pinned as kept. DECRQSS is matched
   the way xterm parses a DCS: it ends at ST or at any other ESC (an abort xterm still answers),
   never at BEL (payload to xterm), and a CAN/SUB abort or a query still open at the end of the
   replay is left alone. A spec renders each case raw and stripped and requires the same screen.
   The 1 MiB tail cut also learns DCS, so a cut inside one no longer leaves its payload as text.
2. `createPaneModePublisher` (`server/session/pty/pane-mode-publish.ts`): when the pane-mode watch
   publishes "left copy-mode", it flushes the session's queued output (so a 2004 set or reset in it
   cannot land after the answer), then sends `?2004h` or `?2004l` from `tmuxBracketedPaste`. That
   read is null when tmux cannot say — a failed query, or a tmux without `bracket_paste_flag` — and
   then nothing is sent, so "unknown" never turns paste protection off. Hooked on the published transition rather than on the
   "Back to input" button, so every way out of copy-mode (button, `q`, scrolling to the bottom)
   resyncs. Only 2004: re-asserting 1049 would clear the alternate screen.

## Not done

- Closing a search prompt that is already open. With the replies stripped nothing opens one; a
  `send-keys Escape` after `cancel` would be a second line of defence but needs measuring on tmux.
- CSI `t` window reports: xterm answers them only with `windowOptions` enabled, which this app
  does not set.
