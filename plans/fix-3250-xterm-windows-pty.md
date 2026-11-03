# fix: tell xterm the pty is a Windows ConPTY (#3250)

Experiment, not a confirmed fix. #3250 reports the same text repeating in the scrollback of a Claude
cell under Claude Code's inline renderer (`tui: default`), on Windows with no tmux. The replay path
(reattach, a different size, past the buffer limit) was run against a stand-in inline renderer and
did not duplicate, so the suspicion moved to the Windows pty itself.

node-pty runs ConPTY on Windows, which repaints the screen when the size changes. xterm reflows what it
already holds on a resize; it is told how a Windows pty behaves only through its `windowsPty` option, and
the terminal was built without it.

What this does: the server reports `terminalWindowsPty` in `/api/config` (ConPTY and the build number
from the release string, null off Windows), and the browser hands it to every xterm, including ones built
before the config arrived. Nothing changes off Windows.

What it does not do: there is no confirmation that the repeats come from here. That needs a Windows
machine. If the repeats go away with this, the reporter's case is explained; if not, the next suspect is
Claude Code's own renderer.

The rule that reads the release string is a pure function in `common/terminalWindowsPty.ts` with its own spec.
