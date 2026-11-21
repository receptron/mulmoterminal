# feat: the board follows terminals opening and closing without waiting for a read (#3363)

Follows #3359: with "only work with an open terminal" on by default, a terminal opened did not show
for up to a minute and one closed stayed on its card.

## Closing (client only)

- The board listens to `closed` on the `sessions` channel itself and drops that session's cell from
  every card (`withoutClosedCells`). The card stays; the switch decides whether an empty card shows.
- A session only waiting to be reaped (its browser went away) is NOT dropped: it is still alive and
  comes back on a reload. It leaves when `closed` arrives.
- Ordering against reads: closes and reads draw stamps from one counter. A read's answer lets go of
  the closes stamped before the read was sent (`closesAfter`), since the server had already removed
  them; a close that arrived while the read was in flight stays, or the answer would put it back.

## Opening (server + client)

- Every pty is registered through `registerPty` (`server/session/pty/pty-register.ts`), which the
  three registration sites now call instead of `ptys.set`. The server publishes `{ sessionId, cwd }`
  on a new `pty-opened` channel (`common/ptyOpenedChannel.ts`).
- A channel of its own, not the `sessions` row the issue first named: every consumer of that row
  reads it as attention state (sound, favicon, cell status, roster), and a row saying only "opened"
  would read as idle — after a server restart it could even end a turn that was working.
- The board reads again `BOARD_TURN_RELOAD_DELAY_MS` after an open, debounced with the turn reload,
  and forgets any close recorded for that session.

## Not changed

- Nothing subscribes while the board is closed; the subscriptions live with the board component.
- A frame missed during a dropped socket is caught by the next read, as before.
