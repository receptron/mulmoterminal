# fix: a crash whose exit record could not be written keeps its cell (#3424)

## Problem

On a full disk every agent fails at once, and every agent cell closed itself as if the user had typed
`/exit`. A restart repeated it: each cell resumed, the resumed agent failed, the cell closed.

The exit recorder (#3272) writes the agent's status to `~/.mulmoterminal/pane-exits/<session>` with a
shell redirect. A full disk fails that write, so no record is left; `programExitCode` then used the
tmux client's status, which is 0 whatever the program did, and `shouldCloseEndedCell` closed the cell.

Reproduced on a throwaway server with a stub `CLAUDE_BIN` that exits 1 after 5s: the cell is kept
when the record directory is writable, and closed when it is read-only or on a disk image filled to
zero bytes free.

## Rule

An agent started under the recorder that leaves no usable record ended in an unknown way. It is not
a clean end, so its cell stays, with a red banner saying how it ended was not recorded.

- `PtyEntry.recordsExit` says the recorder was arranged: every agent through `startAgentPty`, under
  real tmux. Not for shells (never recorded, their code is their last command's) and not for psmux
  (no shell to run the recorder in), so neither changes.
- The exit frame carries `exitUnrecorded`; `shouldCloseEndedCell` refuses on it, on both the server
  (the unplaced mark) and the browser (the cell's own close).
- The banner names the likely cause, since a full disk is otherwise invisible from the cell.

## Accepted limit

A tmux session created by a version older than the recorder, reattached after an upgrade and then
ended cleanly, now keeps its cell (no record, and the entry says it records). It shows the banner and
closes with the button.

## Out of scope

An empty grid on load does not offer the sessions still running in tmux — separate issue and PR.
