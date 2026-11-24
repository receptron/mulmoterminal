// @vitest-environment node
// sendToSession / waitForSessionReply (#3404). They type into a live terminal, so what matters most
// is what must NOT reach the sender: a call from outside a terminal, a session the caller did not
// start, and a session with a question dialog open.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";
import type { AskQuestionEvent } from "../../../common/askQuestion.js";
import type { TurnSnapshot } from "../../../common/turnCorrelation.js";
import { mountSessionAskRoutes } from "../../../server/routes/session-ask-routes.js";
import { createSpawnedSessions, type SpawnedSessions } from "../../../server/session/spawned-sessions.js";
import { InputBlockedError, type SendOptions } from "../../../server/backends/remoteHost/terminalInput.js";
import { SESSION_HEADER } from "../../../server/backends/files/presentPathRoot.js";
import { askTag } from "../../../server/routes/sessionAsk.js";

const CALLER = "0b7d2c1e-1111-4222-8333-944455556666";
const CHILD = "1c8e3d2f-2222-4333-8444-a55566667777";
const OTHER = "2d9f4e30-3333-4444-8555-b66677778888";

interface FakeRes {
  payload: { message?: string } | undefined;
  closeListeners: (() => void)[];
  json(body: { message?: string }): FakeRes;
  on(event: string, listener: () => void): FakeRes;
}
const makeRes = (): FakeRes => ({
  payload: undefined,
  closeListeners: [],
  json(body) {
    this.payload = body;
    return this;
  },
  on(event, listener) {
    if (event === "close") this.closeListeners.push(listener);
    return this;
  },
});

interface Req {
  body: unknown;
  get(name: string): string | undefined;
}
type Handler = (req: Req, res: FakeRes) => Promise<unknown>;

const send = vi.fn<(sessionId: string, text: string, options: SendOptions) => Promise<unknown>>(async () => undefined);
const openQuestion = vi.fn<(sessionId: string) => Promise<AskQuestionEvent | null>>(async () => null);
let permissionPending = false;
const turns: TurnSnapshot[] = [];
const readTurn = vi.fn<() => Promise<TurnSnapshot>>(async () => turns.shift() ?? { prompt: null, reply: null });
let turnReader: () => (() => Promise<TurnSnapshot>) | string = () => readTurn;
let spawned: SpawnedSessions;
const nonces: string[] = [];
// Advances on every read, so a wait that never sees its reply reaches its deadline.
const TICK_MS = 1000;
let clock_ms = 0;

function routes(): { sendRoute: Handler; waitRoute: Handler } {
  const map: Record<string, Handler> = {};
  const app = { post: (path: string, handler: Handler) => (map[path] = handler) } as unknown as Express;
  mountSessionAskRoutes(app, {
    spawned,
    send,
    openQuestion,
    permissionPending: () => permissionPending,
    turnReader: () => turnReader(),
    sleep: async () => undefined,
    now: () => (clock_ms += TICK_MS),
    nonce: () => nonces.shift() ?? "nonce000",
  });
  const sendRoute = map["/api/plugin/sendToSession"];
  const waitRoute = map["/api/plugin/waitForSessionReply"];
  if (!sendRoute || !waitRoute) throw new Error("routes not mounted");
  return { sendRoute, waitRoute };
}

const request = (body: unknown, caller: string | null = CALLER): Req => ({
  body,
  get: (name) => (name.toLowerCase() === SESSION_HEADER ? (caller ?? undefined) : undefined),
});

async function call(handler: Handler, req: Req): Promise<string> {
  const res = makeRes();
  await handler(req, res);
  return res.payload?.message ?? "";
}

beforeEach(() => {
  send.mockClear();
  openQuestion.mockClear();
  permissionPending = false;
  readTurn.mockClear();
  turns.length = 0;
  nonces.length = 0;
  turnReader = () => readTurn;
  spawned = createSpawnedSessions();
  spawned.recordSpawn(CHILD, CALLER);
  spawned.recordSpawn(OTHER, "3eaf5f41-4444-4555-8666-c77788889999");
});

describe("sendToSession", () => {
  it("types the message, tagged, into a session the caller started, and remembers it for the wait", async () => {
    nonces.push("tag00001");
    const tagged = `Review PR #12.${askTag("tag00001")}`;
    expect(send).not.toHaveBeenCalled();
    const message = await call(routes().sendRoute, request({ session: CHILD, message: "Review PR #12." }));
    expect(send).toHaveBeenCalledWith(CHILD, tagged, expect.objectContaining({ blocked: expect.any(Function) }));
    expect(message).toMatch(/Sent to session/);
    expect(spawned.lastSentTo(CHILD)).toBe(tagged);
  });

  it("refuses a call that did not come from a terminal", async () => {
    const message = await call(routes().sendRoute, request({ session: CHILD, message: "hi" }, null));
    expect(message).toMatch(/only from a MulmoTerminal terminal/);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a session another session started", async () => {
    const message = await call(routes().sendRoute, request({ session: OTHER, message: "hi" }));
    expect(message).toMatch(/started by another session/);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a malformed request before looking at who is asking", async () => {
    expect(await call(routes().sendRoute, request({ session: CHILD }))).toMatch(/`message` is required/);
    expect(send).not.toHaveBeenCalled();
  });

  it("asks the question check through the sender, so an open dialog stops the send", async () => {
    openQuestion.mockResolvedValueOnce({ sessionId: CHILD } as unknown as AskQuestionEvent);
    send.mockImplementationOnce(async (_id, _text, options) => {
      if (await options.blocked?.()) throw new InputBlockedError();
    });
    const message = await call(routes().sendRoute, request({ session: CHILD, message: "hi" }));
    expect(message).toMatch(/question dialog/);
    expect(spawned.lastSentTo(CHILD)).toBeUndefined();
  });

  // Its Enter would answer the prompt — the one thing typing must never do.
  it("does not send while the session waits on a permission prompt", async () => {
    permissionPending = true;
    send.mockImplementationOnce(async (_id, _text, options) => {
      if (await options.blocked?.()) throw new InputBlockedError();
    });
    expect(await call(routes().sendRoute, request({ session: CHILD, message: "hi" }))).toMatch(/permission prompt; nothing was sent/);
    expect(spawned.lastSentTo(CHILD)).toBeUndefined();
  });

  it("says the text is still in the box when the dialog opened between paste and Enter, and remembers it", async () => {
    nonces.push("late0001");
    send.mockRejectedValueOnce(new InputBlockedError("blocked before Enter", true));
    const message = await call(routes().sendRoute, request({ session: CHILD, message: "hi" }));
    expect(message).toMatch(/in its input box, not submitted/);
    expect(spawned.lastSentTo(CHILD)).toBe(`hi${askTag("late0001")}`);
  });

  it("reports a session with no live terminal without remembering the text", async () => {
    send.mockRejectedValueOnce(new Error("no live pty"));
    const message = await call(routes().sendRoute, request({ session: CHILD, message: "hi" }));
    expect(message).toMatch(/Could not send.*no live pty/);
    expect(spawned.lastSentTo(CHILD)).toBeUndefined();
  });
});

describe("waitForSessionReply", () => {
  it("does not hand back the earlier reply when the same message is sent again", async () => {
    nonces.push("first001", "second02");
    await call(routes().sendRoute, request({ session: CHILD, message: "re-review, please" }));
    await call(routes().sendRoute, request({ session: CHILD, message: "re-review, please" }));
    turns.push({ prompt: `re-review, please${askTag("first001")}`, reply: "old: changes requested" });
    expect(await call(routes().waitRoute, request({ session: CHILD, waitSeconds: 1 }))).toMatch(/has not answered yet/);
  });

  it("returns the reply to what was sent", async () => {
    spawned.rememberSent(CHILD, "Review PR #12.");
    turns.push({ prompt: "older", reply: "older reply" }, { prompt: "Review PR #12.", reply: "LGTM" });
    const message = await call(routes().waitRoute, request({ session: CHILD, waitSeconds: 10 }));
    expect(message).toContain("LGTM");
  });

  it("refuses to wait before anything was sent", async () => {
    expect(await call(routes().waitRoute, request({ session: CHILD }))).toMatch(/call sendToSession first/);
    expect(readTurn).not.toHaveBeenCalled();
  });

  it("refuses a session the caller did not start, even with text recorded for it", async () => {
    spawned.rememberSent(OTHER, "x");
    expect(await call(routes().waitRoute, request({ session: OTHER }))).toMatch(/started by another session/);
    expect(readTurn).not.toHaveBeenCalled();
  });

  it("passes on why a session's replies cannot be read", async () => {
    spawned.rememberSent(CHILD, "hi");
    turnReader = () => "Replies from a muse session cannot be read yet.";
    expect(await call(routes().waitRoute, request({ session: CHILD }))).toMatch(/muse/);
  });

  it("turns a failing read into a message instead of an error", async () => {
    spawned.rememberSent(CHILD, "hi");
    readTurn.mockRejectedValueOnce(new Error("bad log"));
    expect(await call(routes().waitRoute, request({ session: CHILD }))).toMatch(/Could not read.*bad log/);
  });

  it("writes nothing once the caller has hung up", async () => {
    spawned.rememberSent(CHILD, "hi");
    const res = makeRes();
    readTurn.mockImplementation(async () => {
      res.closeListeners.forEach((listener) => listener());
      return { prompt: null, reply: null };
    });
    await routes().waitRoute(request({ session: CHILD, waitSeconds: 5 }), res);
    expect(res.payload).toBeUndefined();
    readTurn.mockImplementation(async () => turns.shift() ?? { prompt: null, reply: null });
  });
});
