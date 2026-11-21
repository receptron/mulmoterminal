// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  completedCount,
  isRelayMark,
  relayFingerprint,
  relayTurnOf,
  selectRelay,
  type RelayLimits,
  type RelayTurn,
} from "../../../../server/session/transcript/relay-range.js";

const turn = (prompt: string, reply = `answer to ${prompt}`, at: string | null = null): RelayTurn => ({ prompt, replies: [reply], at });
const LIMITS: RelayLimits = { promptMaxChars: 600, totalMaxChars: 10_000 };
const turns = ["a", "b", "c", "d"].map((p) => turn(p));
const select = (over: Partial<Parameters<typeof selectRelay>[0]>) =>
  selectRelay({ turns, completed: turns.length, mark: null, reachedStart: true, limits: LIMITS, ...over });
const sentPrompts = (selection: ReturnType<typeof selectRelay>) => (selection.status === "ok" ? selection.turns.map((t) => t.prompt) : selection.status);

describe("relayTurnOf", () => {
  it("keeps the prompt and every assistant text, commentary included, and drops tool rows", () => {
    expect(
      relayTurnOf({
        at: "2026-11-21T00:00:00Z",
        rows: [
          { kind: "user", text: "q" },
          { kind: "assistant", text: "I'll look." },
          { kind: "tool", text: "read_file {}", call: true },
          { kind: "tool", text: "(output)" },
          { kind: "assistant", text: "   " },
          { kind: "assistant", text: "Done." },
          { kind: "unknown", text: "[unknown block: x]" },
        ],
      }),
    ).toEqual({ prompt: "q", replies: ["I'll look.", "Done."], at: "2026-11-21T00:00:00Z" });
  });

  it("answers null for a turn with no prompt row", () => {
    expect(relayTurnOf({ at: null, rows: [{ kind: "assistant", text: "x" }] })).toBeNull();
  });
});

describe("relayFingerprint", () => {
  it("is a sha256 that ignores surrounding whitespace but not the content", () => {
    const mark = relayFingerprint(turn("q", "r"));
    expect(isRelayMark(mark)).toBe(true);
    expect(relayFingerprint(turn("  q\n", "r "))).toBe(mark);
    expect(relayFingerprint(turn("q", "other"))).not.toBe(mark);
    expect(relayFingerprint(turn("q", "r", "2026-11-21T00:00:00Z"))).not.toBe(mark);
  });

  it("tells apart two turns with the same prompt by their reply", () => {
    expect(relayFingerprint(turn("continue", "first"))).not.toBe(relayFingerprint(turn("continue", "second")));
  });
});

describe("isRelayMark", () => {
  it.each([[""], ["A".repeat(64)], ["0".repeat(63)], [1], [null]])("refuses %j", (value) => {
    expect(isRelayMark(value)).toBe(false);
  });
});

describe("completedCount", () => {
  it("counts up to the newest turn whose trimmed prompt is the last completed one", () => {
    expect(completedCount(turns, "d")).toBe(4);
    expect(completedCount(turns, "  c\n")).toBe(3);
    expect(completedCount([...turns, turn("c")], "c")).toBe(5);
  });

  it("matches a view prompt that carries leading blank lines the last-turn read does not", () => {
    expect(completedCount([turn("a"), turn("\n\n<pasted>q</pasted>")], "<pasted>q</pasted>")).toBe(2);
  });

  it("treats the newest turn as running when no prompt matches", () => {
    expect(completedCount(turns, "never asked")).toBe(3);
  });

  it("answers 0 with no completed exchange or no turns", () => {
    expect(completedCount(turns, null)).toBe(0);
    expect(completedCount([], "a")).toBe(0);
  });
});

describe("selectRelay", () => {
  it("sends every completed turn on the first relay, and marks the newest", () => {
    const selection = select({});
    expect(sentPrompts(selection)).toEqual(["a", "b", "c", "d"]);
    expect(selection).toMatchObject({ omitted: 0, moreBefore: false, markLost: false, mark: relayFingerprint(turns[3]) });
  });

  it("sends only the turns after the marker", () => {
    expect(sentPrompts(select({ mark: relayFingerprint(turns[1]) }))).toEqual(["c", "d"]);
  });

  it("leaves out a turn still running, and marks the newest completed one", () => {
    const selection = select({ mark: relayFingerprint(turns[0]), completed: 3 });
    expect(sentPrompts(selection)).toEqual(["b", "c"]);
    expect(selection).toMatchObject({ mark: relayFingerprint(turns[2]) });
  });

  it("says nothing is new when the marker is the newest completed turn", () => {
    expect(select({ mark: relayFingerprint(turns[3]) })).toEqual({ status: "nothing-new" });
    expect(select({ mark: relayFingerprint(turns[2]), completed: 3 })).toEqual({ status: "nothing-new" });
  });

  it("has nothing to send without a completed turn", () => {
    expect(select({ completed: 0 })).toEqual({ status: "no-turn" });
    expect(select({ turns: [], completed: 0 })).toEqual({ status: "no-turn" });
  });

  it("falls back to the latest exchange when the marker is nowhere in the whole conversation", () => {
    const selection = select({ mark: "0".repeat(64) });
    expect(sentPrompts(selection)).toEqual(["d"]);
    expect(selection).toMatchObject({ markLost: true, omitted: 0 });
  });

  it("does not call a marker lost when the read stopped before the start — it sends what was read", () => {
    const selection = select({ mark: "0".repeat(64), reachedStart: false });
    expect(sentPrompts(selection)).toEqual(["a", "b", "c", "d"]);
    expect(selection).toMatchObject({ markLost: false, moreBefore: true });
  });

  it("takes the newest turns that fit the budget and counts the rest", () => {
    const long = ["a", "b", "c", "d"].map((p) => turn(p, "x".repeat(40)));
    const selection = select({ turns: long, limits: { promptMaxChars: 600, totalMaxChars: 90 } });
    expect(sentPrompts(selection)).toEqual(["c", "d"]);
    expect(selection).toMatchObject({ omitted: 2, moreBefore: false });
  });

  it("still sends the newest turn when it alone is over the budget", () => {
    const selection = select({ turns: [turn("a", "x".repeat(500))], completed: 1, limits: { promptMaxChars: 600, totalMaxChars: 10 } });
    expect(sentPrompts(selection)).toEqual(["a"]);
  });

  it("counts a long prompt only up to the prompt limit", () => {
    const long = [turn("p".repeat(1000), "r"), turn("q", "r")];
    expect(sentPrompts(select({ turns: long, completed: 2, limits: { promptMaxChars: 5, totalMaxChars: 10 } }))).toEqual([long[0].prompt, "q"]);
  });

  it("finds the NEWEST turn matching the marker when an exchange repeats exactly", () => {
    const repeated = [turn("go", "ok"), turn("x"), turn("go", "ok"), turn("y")];
    expect(sentPrompts(select({ turns: repeated, completed: 4, mark: relayFingerprint(repeated[0]) }))).toEqual(["y"]);
  });
});
