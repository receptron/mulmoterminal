# feat: the token badge for a cursor cell (capability matrix row 15)

Follows #2064 / #2065 / #2066. Row 15 of [`docs/agent-capability-matrix.md`](../docs/agent-capability-matrix.md)
was the last accounting gap with data already arriving: five of the seven agents wear the
`⇡12.3k ⇣4.5k` badge, cursor and copilot do not.

## The measurement this rests on

`stop`, captured from a running cursor cell (cursor-agent 2026.09.10-fd3934a):

```json
{ "conversation_id": "f4fc9a97-…", "generation_id": "23ca0cff-…", "model": "default",
  "status": "completed", "loop_count": 0,
  "input_tokens": 20152, "output_tokens": 15, "cache_read_tokens": 8704, "cache_write_tokens": 0,
  "transcript_path": "/Users/…/agent-transcripts/f4fc9a97-…/f4fc9a97-….jsonl" }
```

Three things follow, and two of them are traps:

1. **Cursor states its counts in NO file.** Its transcript `.jsonl` carries the conversation and no
   usage at all (checked against a real one). Every other agent here is folded from a re-readable
   log on each badge poll; cursor's arrive pushed, once per turn, so they are folded **in memory**.
   Consequence, stated rather than hidden: a server restart starts the count again, and a resumed
   cell shows nothing until its next turn ends. Both are absent, not wrong.
2. **`model` is `"default"`** on an Auto session — cursor's word for "not pinned", not a model id.
   Dropped, or the header would read `default` where every other cell names its model. That is also
   why this does **not** deliver `ctx %`: the percentage needs a context window, cursor states none,
   and the client's fallback table is keyed by model id. Pin one (`CURSOR_MODEL` → `--model`) and
   the payload names it, and the percentage appears with no further change here.
3. **`input_tokens` is the turn's whole input**, so it plays `last_token_usage.input_tokens`'s role
   for the context figure. `cache_read_tokens` is NOT added to it: whether cursor already counts it
   inside is unmeasured, and double-counting is the error that tells a user to compact when they
   need not. Measured across two turns of one session it went 20152 → 16896 while the cached read
   went 8704 → 0, so it is the turn's figure and not a running total.

## Shape

- `server/agents/cursor-usage.ts` — the pure fold (one payload → badges; previous + turn → badges,
  usage summed and context replaced) plus the per-session store.
- `server/routes/hook-routes.ts` — records on a cursor `Stop`, from the RAW payload (the translation
  into claude's vocabulary has no field to carry these in), and **before** the activity publish, for
  the reason `noteWorkPhase` is: that push is what makes the cell re-read its badges.
- `server/session/agent-badges.ts` — a `cursor` branch, and **copilot made explicit**: every agent
  added since that function was written fell through to antigravity's reader, so a copilot id was
  being looked up under agy's HOME. It answers nothing only because nothing is there.
- `server/session/lifecycle.ts` — forgotten with the session's other memory.

No UI change: the cell already re-reads its badges on the working → settled transition, and cursor
drives both halves of that (#2065).

## Verified by running it

A real server, a cursor cell over `/ws/cursor`, and two turns driven in the pane:

| after | `usage.inputTokens` | `context.contextTokens` |
|---|---|---|
| turn 1 | 20152 | 20152 |
| turn 2 | 37048 | 16896 |

— which is the split the fold claims: the ⇡⇣ badge accumulates, the context figure is the latest
turn's. `model` stayed `null` throughout, as an Auto session should.
