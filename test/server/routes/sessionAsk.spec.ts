// @vitest-environment node
// The rules behind sendToSession / waitForSessionReply (#3404): what a request may carry, which
// session a caller may address, and how one bounded wait ends.
import { describe, it, expect } from "vitest";
import {
  addressRefusal,
  awaitReply,
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
  parseSendRequest,
  parseWaitRequest,
  REPLY_POLL_MS,
  REPLY_RESULT_MAX_CHARS,
  replyMessage,
  type ReplyWaitDeps,
} from "../../../server/routes/sessionAsk.js";
import { REPLY_MAX_CHARS } from "../../../server/routes/terminalReply.js";
import type { TurnSnapshot } from "../../../common/turnCorrelation.js";

const CALLER = "0b7d2c1e-1111-4222-8333-944455556666";
const CHILD = "1c8e3d2f-2222-4333-8444-a55566667777";
const STRANGER = "2d9f4e30-3333-4444-8555-b66677778888";
const MS = 1000;

describe("parseSendRequest", () => {
  it("accepts a session id and a message", () => {
    expect(parseSendRequest({ session: CHILD, message: "review PR #12" })).toEqual({ ok: true, session: CHILD, message: "review PR #12" });
  });

  it.each([
    ["no body", undefined],
    ["a non-object body", "text"],
    ["no session", { message: "hi" }],
    ["a session that is not an id", { session: "abc", message: "hi" }],
    ["a session that is not a string", { session: 42, message: "hi" }],
    ["no message", { session: CHILD }],
    ["an empty message", { session: CHILD, message: "" }],
    ["a message of control bytes only", { session: CHILD, message: "\u0003\u001b" }],
    ["a message that is not a string", { session: CHILD, message: ["hi"] }],
    ["a message over the cap", { session: CHILD, message: "x".repeat(REPLY_MAX_CHARS + 1) }],
  ])("refuses %s", (_label, body) => {
    expect(parseSendRequest(body).ok).toBe(false);
  });

  it("accepts a message exactly at the cap", () => {
    expect(parseSendRequest({ session: CHILD, message: "x".repeat(REPLY_MAX_CHARS) }).ok).toBe(true);
  });
});

describe("parseWaitRequest", () => {
  const waitOf = (waitSeconds: unknown): number | null => {
    const parsed = parseWaitRequest({ session: CHILD, waitSeconds });
    return parsed.ok ? parsed.waitMs : null;
  };

  it("defaults the wait when it is absent or not a positive number", () => {
    [undefined, null, "30", 0, -5, Number.NaN, Number.POSITIVE_INFINITY].forEach((value) => expect(waitOf(value)).toBe(DEFAULT_WAIT_SECONDS * MS));
  });

  it("takes a wait inside the range as given", () => {
    expect(waitOf(10)).toBe(10 * MS);
  });

  it("pulls a long wait down to the maximum rather than refusing it", () => {
    expect(waitOf(3600)).toBe(MAX_WAIT_SECONDS * MS);
  });

  it("never waits less than a second", () => {
    expect(waitOf(0.001)).toBe(MS);
  });

  it("refuses a request without a session id", () => {
    expect(parseWaitRequest({ waitSeconds: 5 }).ok).toBe(false);
    expect(parseWaitRequest(null).ok).toBe(false);
  });
});

describe("addressRefusal", () => {
  const parents = new Map([
    [CHILD, CALLER],
    [STRANGER, CHILD],
  ]);
  const parentOf = (session: string): string | undefined => parents.get(session);

  it("lets a caller address a session it started", () => {
    expect(addressRefusal(CALLER, CHILD, parentOf)).toBeNull();
  });

  it("refuses the caller's own session", () => {
    expect(addressRefusal(CALLER, CALLER, parentOf)).toMatch(/your own session/);
  });

  it("refuses a session another session started", () => {
    expect(addressRefusal(CALLER, STRANGER, parentOf)).toMatch(/started by another session/);
  });

  it("refuses a session nobody recorded starting, naming the restart as a cause", () => {
    expect(addressRefusal(CALLER, "3eaf5f41-4444-4555-8666-c77788889999", parentOf)).toMatch(/restarted/);
  });
});

/** A turn reader that answers each call with the next snapshot, holding the last one. */
function fakeClock(turns: TurnSnapshot[], aborted = (): boolean => false): { deps: ReplyWaitDeps; reads: () => number; slept: () => number } {
  const state = { now: 0, reads: 0, slept: 0 };
  const deps: ReplyWaitDeps = {
    readTurn: async () => turns[Math.min(state.reads++, turns.length - 1)] ?? { prompt: null, reply: null },
    sleep: async (ms) => {
      state.now += ms;
      state.slept += 1;
    },
    now: () => state.now,
    isAborted: aborted,
  };
  return { deps, reads: () => state.reads, slept: () => state.slept };
}

describe("awaitReply", () => {
  const SENT = "Review PR #12 and answer LGTM or the changes you want.";
  const previous: TurnSnapshot = { prompt: "an earlier question", reply: "an earlier answer" };
  const ours: TurnSnapshot = { prompt: SENT, reply: "LGTM" };

  it("answers at once, without sleeping, when the reply is already there", async () => {
    const clock = fakeClock([ours]);
    expect(await awaitReply(SENT, 10 * MS, clock.deps)).toEqual({ status: "answered", reply: "LGTM" });
    expect(clock.slept()).toBe(0);
  });

  it("keeps polling past a turn that answers something else", async () => {
    const clock = fakeClock([previous, previous, ours]);
    expect(await awaitReply(SENT, 10 * MS, clock.deps)).toEqual({ status: "answered", reply: "LGTM" });
    expect(clock.reads()).toBe(3);
  });

  it("says it is still waiting once the wait is used up", async () => {
    const clock = fakeClock([previous]);
    expect(await awaitReply(SENT, 3 * REPLY_POLL_MS, clock.deps)).toEqual({ status: "waiting" });
  });

  it("stops when the caller hangs up", async () => {
    const clock = fakeClock([previous], () => true);
    expect(await awaitReply(SENT, 10 * MS, clock.deps)).toEqual({ status: "aborted" });
    expect(clock.reads()).toBe(1);
  });

  it("answers an empty reply as empty text rather than waiting on", async () => {
    const clock = fakeClock([{ prompt: SENT, reply: null }]);
    expect(await awaitReply(SENT, 10 * MS, clock.deps)).toEqual({ status: "answered", reply: "" });
  });

  it("does not count a session with no turn yet", async () => {
    const clock = fakeClock([{ prompt: null, reply: null }]);
    expect(await awaitReply(SENT, REPLY_POLL_MS, clock.deps)).toEqual({ status: "waiting" });
  });

  it("lets a failing read propagate to the route", async () => {
    const deps: ReplyWaitDeps = { ...fakeClock([]).deps, readTurn: async () => Promise.reject(new Error("unreadable log")) };
    await expect(awaitReply(SENT, MS, deps)).rejects.toThrow("unreadable log");
  });
});

describe("replyMessage", () => {
  it("carries the reply", () => {
    expect(replyMessage(CHILD, { status: "answered", reply: "LGTM" })).toContain("LGTM");
  });

  it("cuts an oversized reply and says where", () => {
    const message = replyMessage(CHILD, { status: "answered", reply: "y".repeat(REPLY_RESULT_MAX_CHARS + 50) });
    expect(message).toContain(`[cut at ${REPLY_RESULT_MAX_CHARS} characters]`);
    expect(message.length).toBeLessThan(REPLY_RESULT_MAX_CHARS + 200);
  });

  it("tells the caller to call again while waiting", () => {
    expect(replyMessage(CHILD, { status: "waiting" })).toMatch(/waitForSessionReply again/);
  });

  it("says a turn ended without text", () => {
    expect(replyMessage(CHILD, { status: "answered", reply: "  " })).toMatch(/without any text/);
  });
});
