# feat: a cursor cell's last turn (capability matrix row 12)

Follows #2064 / #2065 / #2066. Row 12 — *last turn → the finished-turn push, handoff, round table* —
answered `—` for cursor, so a cursor cell's finished turn pushed a notification with no reply in it,
and a handoff from one carried nothing.

## The format, measured

`~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`, one JSON object per line, from a real
turn (cursor-agent 2026.09.10-fd3934a):

```
{"role":"user","message":{"content":[{"type":"text","text":"<timestamp>…</timestamp>\n<user_query>\n…\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"I'll read probe.txt…"},{"type":"tool_use","name":"Read",…}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Write",…}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"DONE"}]}}
{"type":"turn_ended","status":"success"}
```

## The one decision in it

WHICH text is the answer. Claude's reader paid for this lesson: 78% of the assistant prose in a
sample of real transcripts is mid-turn narration, and #1487 is a round table that was handed
*"I'll read the actual files before weighing in."* as a seat's whole contribution.

Cursor gives a turn boundary outright (`turn_ended`) and no per-record "this ends the turn" flag, so
the rule is stricter than "the last prose before it":

> the reply is the last assistant record before `turn_ended` **that carries no tool call**.

A record mixing prose with a `tool_use` is a preamble by construction — the turn continued, or the
tool would not be there. The cost is answering `null` for a turn that ended without prose; the cost
of the loose rule is quoting a preamble as the conclusion, which cannot be seen at the other end.

## Shape

- `server/agents/cursor-last-turn.ts` — the pure reader, plus the `<user_query>` unwrapping the
  conversation list already does for a title.
- `server/agents/cursor-sessions.ts` — `cursorTranscriptPath(cwd, id)`, which asks each of the cwd's
  project directories what it stands for. The slug cannot be reconstructed, and `stop`'s
  `transcript_path` only arrives on a turn boundary — a reader between turns cannot wait for one.
- `server/session/session-reads.ts` — the cursor branch, reading a bounded TAIL as codex's does.

## Verified by running it

A real server, a cursor cell, and a turn that used a tool before answering. `GET
/api/transcript/last-turn?agent=cursor`:

```json
{ "prompt": "Read the file .cursor/mcp.json and then tell me in one short sentence what MCP server it registers.",
  "reply": "It registers the **mulmoterminal-render** MCP server, started via Node running `bridge.mjs` with the `render` group on port 34591." }
```

The preamble that carried the `Read` call is not the reply, which is the rule above holding on a
real turn rather than on a fixture.
