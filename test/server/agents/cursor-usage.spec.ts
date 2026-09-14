// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  cursorStopBadges,
  foldCursorBadges,
  EMPTY_CURSOR_BADGES,
  recordCursorStop,
  cursorBadges,
  forgetCursorBadges,
} from "../../../server/agents/cursor-usage.js";

// The payload as cursor-agent 2026.09.10-fd3934a really sends it, captured from a running cell.
// Kept whole rather than trimmed to the fields read: the two traps below are both about a field
// that is present and means something other than it looks like.
const STOP = {
  conversation_id: "f4fc9a97-0635-45c3-99dd-2bf30053739f",
  generation_id: "23ca0cff-1be7-4fba-8b55-4a0eb3ad0fa2",
  model: "default",
  status: "completed",
  loop_count: 0,
  input_tokens: 20152,
  output_tokens: 15,
  cache_read_tokens: 8704,
  cache_write_tokens: 0,
  hook_event_name: "stop",
  cursor_version: "2026.09.10-fd3934a",
};

describe("cursorStopBadges", () => {
  it("reads the four counts off one stop payload", () => {
    expect(cursorStopBadges(STOP).usage).toEqual({ inputTokens: 20152, outputTokens: 15, cacheReadTokens: 8704, cacheCreationTokens: 0 });
  });

  // TRAP 1. `default` is cursor's word for an Auto session, not a model id — rendering it would put
  // the literal text "default" where every other cell names its model.
  it("does not treat `default` as a model name", () => {
    expect(cursorStopBadges(STOP).context.model).toBeNull();
  });

  it("keeps a model the user did pin", () => {
    expect(cursorStopBadges({ ...STOP, model: "claude-4.5-sonnet" }).context.model).toBe("claude-4.5-sonnet");
  });

  // TRAP 2. The turn's input is the context for the NEXT turn — codex's `last_token_usage` role.
  // The cached half is deliberately NOT added: whether cursor already counts it inside
  // `input_tokens` is unmeasured, and double-counting tells the user to compact when they need not.
  it("answers the context from the turn's input alone", () => {
    expect(cursorStopBadges(STOP).context.contextTokens).toBe(20152);
  });

  it("states no context window, because cursor states none", () => {
    expect(cursorStopBadges(STOP).context.contextWindow).toBeNull();
  });

  it("answers zeroes for a payload that is not a record", () => {
    expect(cursorStopBadges(null)).toEqual(EMPTY_CURSOR_BADGES);
    expect(cursorStopBadges("stop")).toEqual(EMPTY_CURSOR_BADGES);
  });

  it("ignores counts that are not finite non-negative numbers", () => {
    const odd = { ...STOP, input_tokens: "20152", output_tokens: -3, cache_read_tokens: Number.NaN };
    expect(cursorStopBadges(odd).usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});

describe("foldCursorBadges", () => {
  // The split that matters: the ⇡⇣ badge accumulates, the context bar is the LATEST turn's. A fold
  // that added the contexts would report a session as fuller than it is, every turn.
  it("sums the usage and replaces the context", () => {
    const first = cursorStopBadges({ ...STOP, input_tokens: 100, output_tokens: 10 });
    const second = cursorStopBadges({ ...STOP, input_tokens: 300, output_tokens: 20 });
    const folded = foldCursorBadges(foldCursorBadges(EMPTY_CURSOR_BADGES, first), second);
    expect(folded.usage.inputTokens).toBe(400);
    expect(folded.usage.outputTokens).toBe(30);
    expect(folded.context.contextTokens).toBe(300);
  });

  it("keeps a model a later Auto turn did not name", () => {
    const pinned = foldCursorBadges(EMPTY_CURSOR_BADGES, cursorStopBadges({ ...STOP, model: "gpt-5" }));
    expect(foldCursorBadges(pinned, cursorStopBadges(STOP)).context.model).toBe("gpt-5");
  });
});

describe("the per-session store", () => {
  it("adds up a session's turns and forgets it when the session ends", () => {
    const id = "b1a1f0ee-0000-4000-8000-000000000001";
    recordCursorStop(id, { ...STOP, input_tokens: 100, output_tokens: 1 });
    recordCursorStop(id, { ...STOP, input_tokens: 250, output_tokens: 2 });
    expect(cursorBadges(id).usage.inputTokens).toBe(350);
    expect(cursorBadges(id).context.contextTokens).toBe(250);
    forgetCursorBadges(id);
    expect(cursorBadges(id)).toEqual(EMPTY_CURSOR_BADGES);
  });

  // A session that has not finished a turn under THIS process — a resume, or a restart — wears no
  // badge rather than a wrong one.
  it("answers zeroes for a session it has never heard from", () => {
    expect(cursorBadges("b1a1f0ee-0000-4000-8000-000000000002")).toEqual(EMPTY_CURSOR_BADGES);
  });
});
