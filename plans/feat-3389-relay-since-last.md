# feat: bring every exchange since the last relay (#3389)

A second handoff action beside "Bring that turn here": paste every exchange of the other terminal's
conversation that this directory has not received yet.

## Decisions (from the issue)

- Separate action; the last-turn handoff is unchanged.
- Record key: `(source agent, source conversation id, destination cwd)`. The conversation id is
  `transcriptIdOf(session)`, the same one `/api/transcript/last-turn` reads.
- A turn carries the prompt and every assistant text (commentary included); tool rows are dropped.
- Pasted, never submitted.

## Shape

- `server/session/transcript/relay-range.ts` — pure. Turns from the conversation view become
  `RelayTurn {prompt, replies, at}`; a fingerprint names one; `selectRelay` decides what to send
  from the turns read, the marker, how many are complete, and whether the read reached the start.
- `server/session/transcript/relay-read.ts` — the paging loop, with the page reader and the
  last-turn read injected. Pages backwards through `sessionTranscriptPage` until the marker is
  seen, the character budget is spent, the start is reached, or the page limit is hit.
- `formatRelay` in `handoff-text.ts`, beside `formatHandoff`, sharing its clipping, sanitizing
  and framing.
- `relay-marks.ts` (pure log line / record / fold) and `relay-mark-store.ts` (hydrate + append)
  — an append log under `~/.mulmoterminal/`, last line per key wins, like the memo log, so two
  server instances never lose each other's writes.
- Routes: `GET /api/transcript/relay` answers the text and the marker to record;
  `POST /api/transcript/relay-mark` records it. Two calls because the marker may only move once
  the paste succeeded, which only the browser knows.
- UI: a third button on each row of the cell's handoff menu.

## Completed turns

The newest view turn may still be running. A turn counts as complete up to the one whose prompt
(trimmed) equals `sessionLastTurn`'s prompt. If none matches, the newest turn is treated as
running and left out. Measured over the newest real claude transcripts on one machine, the
trimmed prompt matched in all but a compaction summary, which the fallback handles.

## Fallbacks

- No completed turn: nothing is pasted, the cell says so.
- Marker equals the newest completed turn: "nothing new".
- Marker not found after reading back to the start (compaction, rewind, rewritten log): only the
  latest exchange is sent, and the text says where the last relay ended could not be found.
- Budget or page limit reached before the marker: the newest turns that fit are sent, and the text
  says earlier exchanges were left out.
- First relay (no marker): the newest turns that fit.
