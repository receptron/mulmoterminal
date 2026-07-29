# Restore the terminal's sticky modes on reattach

Fixes #1073. 2026-07-29.

## Why

After a reattach — sidebar switch, reload, second tab (`superseded`), WebSocket reconnect — a
Claude/Codex cell stops delivering the wheel to the app. The transcript can't be scrolled past
the current screen, and the TUI's own click targets (#845) go dead at the same moment.

Both come from one gate, which requires **two** things at once:

```ts
// src/composables/terminalMouseInput.ts
term.buffer.active.type === "alternate" && wantsMouseReports(swallowedMouseModes)
```

and a reattach destroys both:

1. The client starts clean — `connect()` calls `c.term.reset()` (back to the normal buffer) and
   `c.swallowedMouseModes.clear()` (`useTerminalConnections.ts`).
2. The server replays only a bounded tail — `entry.buffer`, capped at 1 MiB by
   `appendBoundedOutput` (`spawn-claude.ts`, `spawn-codex.ts`, `spawn-shell.ts`).
3. `ESC[?1049h` is written **once, at offset 0** of the pty stream, when the tmux client attaches,
   and never again. Past 1 MiB of output it is guaranteed to have fallen off the front of the
   replay; the mouse modes fall off too unless the app happened to re-set them late.

So xterm restores into the normal buffer with an empty mode record, `reportsMouseToApp()` is false
forever, and nothing in an ordinary conversation puts it back (a server restart does, because the
pty — and its offset 0 — is recreated).

The history itself is fine. #1073 measured it: injecting the same SGR wheel-up report the client
synthesises walks Claude Code back to the first turn. What is broken is **delivery**, not storage.

## What

Restore the modes ahead of the replay, and read them from **tmux** rather than tracking the byte
stream ourselves. tmux is the emulator that owns this pane's state and already exposes it:

```
mt-0108e983…  cmd=2.1.220  alt=1 std=0 btn=0 all=1 sgr=1   <- Claude Code
mt-0937e3b2…  cmd=zsh      alt=0 std=0 btn=0 all=0 sgr=0   <- shell cell
```

(measured on live sessions of this checkout, tmux 3.6a / Claude Code 2.1.220)

That removes every hard part of the stream-tracking approach #1073 sketched: no DECRST tracking,
no CSI split across pty chunks, no reset handling. One `display-message` at reattach, ~7 ms, in a
path that already makes sync tmux calls (`tmuxPaneCommand`).

| tmux flag | mode |
|---|---|
| `alternate_on` | 1049 |
| `mouse_standard_flag` | 1000 |
| `mouse_button_flag` | 1002 |
| `mouse_all_flag` | 1003 |
| `mouse_utf8_flag` | 1005 |
| `mouse_sgr_flag` | 1006 |

1001 / 1015 / 1016 are in the client's swallow set but tmux has no flag for them; no current agent
asks for them, and `wantsMouseReports` needs 1006 plus one of 1000/1001/1002/1003, which the table
covers. 2004 (bracketed paste) and cursor-key mode stay out of scope, as #1073 argues.

### Pieces

- `server/infra/tmux.ts` — `parseTmuxTerminalModes(stdout)` (pure) and `tmuxTerminalModes(id)`.
  One comma-joined format string built from the same table the parser indexes, so an unknown
  variable on an older tmux renders empty without shifting the fields.
- `server/session/terminal-replay.ts` — `terminalModePrefix(modes)`, the DECSETs as a string.
- `server/session/pty-connection.ts` — `reattachPty` sends `prefix + stripTerminalQueries(buffer)`,
  and asks only when `entry.tmux`.
- `server/index.ts` — binds the dep.

### One sequence per mode, never combined

`terminalModePrefix` emits `ESC[?1049h ESC[?1003h ESC[?1006h`, not `ESC[?1049;1003;1006h`. The
client's `swallowsMouseTracking` only swallows a sequence whose parameters are **all** mouse modes;
a combined one would pass through to xterm, which would then enable real mouse tracking and turn
every drag into coordinate reports — the exact regression #729 exists to prevent. A test pins it.

The prefix must also go through the client's parser (not a side-channel frame) so
`guardMouseTracking`'s `?h` handler rebuilds `swallowedMouseModes`. No client change is needed.

## Scope

- **Not** tmux-backed sessions (`entry.tmux` false — sandbox containers, tmux-less hosts) keep
  today's behaviour. They don't survive a server restart anyway.
- Shell cells report `alt=0` and every flag 0, so their prefix is empty — unchanged. A shell cell
  running vim gets `?1049h` restored, which is a bonus fix of the same bug.

## Behaviour change to review

Before this, a reattached Claude cell rendered its replayed tail into the **normal** buffer, so
whatever scrolled there became xterm scrollback. After, the tail renders into the alternate buffer,
which has none — the same as a live connection that never detached.

Measured on the captured 1 MiB replay, rendered at the session's real geometry:

```
without prefix (old)   buffer=normal      scrollable above screen =  9 lines
with prefix (new)      buffer=alternate   scrollable above screen =  0 lines
```

Nine lines, from a stream of `seq 1 200000` — the most scroll-heavy content there is. It is that
small because tmux is the renderer: it repaints the screen in place (`ESC[H`, `ESC[30S`) instead of
emitting newlines, so almost nothing ever reaches the outer terminal's scrollback. This is #782's
finding, and a Claude cell (pure repaints, no line scrolling) has even less — which is why #1073's
symptom is "nothing above the current screen appears".

So the trade is 9 lines of tmux-repaint residue for the app's complete transcript. #782's selection
limits are unchanged either way.

## Tests

- `parseTmuxTerminalModes`: Claude-shaped row, all-zero shell row, empty stdout, an empty field
  from an unknown variable not shifting the rest.
- `terminalModePrefix`: empty in / empty out; one DECSET per mode; never a combined parameter list.
- `reattachPty`: prefix ahead of the replay; nothing for a non-tmux entry; the prefix still sent
  when the buffer is empty; not asked for at all when the socket is closed.

## Measured, against a real server

A shell session put into Claude Code's state (`printf '\033[?1049h\033[?1003h\033[?1006h'`), driven
past the 1 MiB limit, then reattached over a second socket (the `superseded` path):

```
                 before                              after
live bytes       1415050 (overran)                   1395114 (overran)
replay bytes     1048576                             1048600   (= tail + 24-byte prefix)
?1049h           0 occurrences                       at offset 0
?1003h           5, first at 720818                  at offset 8
?1006h           5, first at 720794                  at offset 16
```

The before column is the issue's claim exactly: the mouse modes happened to survive (an app re-sets
those), and `?1049h` did not — and the gate needs both, so the wheel was dead either way.

That captured replay was then rendered both ways through `@xterm/headless` at the session's real
geometry. The **visible screen is byte-identical**; only `buffer.active.type` differs (`alternate`
vs `normal`). So the restore costs nothing on screen — the difference is only which buffer holds
it, and hence the scrollback noted above.

## One unrelated type change

`cellFromPoint` took a `DOMRect`, the only browser type in `mouseReports.ts` — which otherwise
holds pure rules, as its own header says. That made the module unimportable from a node test
project, and the spec above needs exactly that. Narrowed to a local `ScreenBox` (`left/top/width/
height`), which a `DOMRect` satisfies structurally; no call site changes.

## Docs

`docs/terminal-notes.md` (replay section + the mouse-tracking section) and the bug-report FAQ
entry, which currently describes the alt-screen limits without mentioning that reattach used to
sever wheel delivery entirely.
