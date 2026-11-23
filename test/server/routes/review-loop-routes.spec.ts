// @vitest-environment node
// requestReview / endReview (#3409): the server sends a round to the reviewer, waits for it in the
// background, and types how it ended into the author's session. What matters most is what must not
// happen — a round to a session the caller did not start or one that runs another agent, two rounds
// at once, a result delivered after the loop ended, a result typed over an open dialog.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";
import type { AskQuestionEvent } from "../../../common/askQuestion.js";
import type { TurnSnapshot } from "../../../common/turnCorrelation.js";
import type { ReviewSettings } from "../../../common/reviewSettings.js";
import { mountReviewLoopRoutes, DELIVERY_ATTEMPTS } from "../../../server/routes/review-loop-routes.js";
import { REVIEW_WAIT_MS, type ReviewLoop } from "../../../server/routes/reviewLoop.js";
import type { PrReviewState } from "../../../server/git/pr-review-state.js";
import { createSpawnedSessions, type SpawnedSessions } from "../../../server/session/spawned-sessions.js";
import { InputBlockedError, type SendOptions } from "../../../server/backends/remoteHost/terminalInput.js";
import { SESSION_HEADER } from "../../../server/backends/files/presentPathRoot.js";

const AUTHOR = "0b7d2c1e-1111-4222-8333-944455556666";
const REVIEWER = "1c8e3d2f-2222-4333-8444-a55566667777";
const OTHER = "2d9f4e30-3333-4444-8555-b66677778888";
const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
const SETTINGS: ReviewSettings = { reviewer: "codex", maxRounds: 3, requiredLgtm: 1 };
const BODY = { repo: "owner/repo", pr: 7, reviewer: REVIEWER };

interface Req {
  body: unknown;
  get(name: string): string | undefined;
}
type Handler = (req: Req, res: { json: (body: { message?: string }) => void }) => unknown;

const send = vi.fn<(sessionId: string, text: string, options: SendOptions) => Promise<unknown>>(async () => undefined);
const openQuestion = vi.fn<(sessionId: string) => Promise<AskQuestionEvent | null>>(async () => null);
const close = vi.fn<(session: string) => void>();
let reply: string | null;
let settings: ReviewSettings | string;
let pr: PrReviewState | string;
/** When set, every PR read waits on it — to hold a round between its answer and its message. */
let prGate: (() => Promise<void>) | null;
let sleep: (ms: number) => Promise<void>;
let agent: string | undefined;
/** Sessions other than the reviewer that are running here. */
let running: Set<string>;
let spawned: SpawnedSessions;
let loops = new Map<string, ReviewLoop>();
let clock_ms = 0;
const TICK_MS = 1000;

/** What the reviewer last received, so its turn can answer exactly that prompt. */
const sentToReviewer = (): string => send.mock.calls.filter(([session]) => session === REVIEWER).at(-1)?.[1] ?? "";
const typedToAuthor = (): string[] => send.mock.calls.filter(([session]) => session === AUTHOR).map(([, text]) => text);

function agentOf(session: string): string | undefined {
  if (session === REVIEWER) return agent;
  return running.has(session) ? "claude" : undefined;
}

async function readTurn(): Promise<TurnSnapshot> {
  return reply === null ? { prompt: null, reply: null } : { prompt: sentToReviewer(), reply };
}

function routes(): { requestRoute: Handler; endRoute: Handler } {
  const map: Record<string, Handler> = {};
  const app = { post: (path: string, handler: Handler) => (map[path] = handler) } as unknown as Express;
  mountReviewLoopRoutes(app, {
    spawned,
    send,
    openQuestion,
    turnReader: () => readTurn,
    sleep: (ms) => sleep(ms),
    now: () => (clock_ms += TICK_MS),
    nonce: () => "nonce000",
    loops,
    settingsOf: async () => settings,
    prState: async () => {
      await prGate?.();
      return pr;
    },
    agentOf,
    close,
  });
  const requestRoute = map["/api/plugin/requestReview"];
  const endRoute = map["/api/plugin/endReview"];
  if (!requestRoute || !endRoute) throw new Error("routes not mounted");
  return { requestRoute, endRoute };
}

const req = (body: unknown, caller: string | null = AUTHOR): Req => ({
  body,
  get: (name) => (name.toLowerCase() === SESSION_HEADER ? (caller ?? undefined) : undefined),
});

async function call(handler: Handler, request: Req): Promise<string> {
  let message = "";
  await handler(request, { json: (body) => (message = body.message ?? "") });
  return message;
}

const roundsEnded = (count: number): Promise<void> => vi.waitFor(() => expect(typedToAuthor()).toHaveLength(count));

beforeEach(() => {
  // Ends any round a previous test left waiting: its watcher stops once its loop is gone.
  loops.clear();
  send.mockReset();
  send.mockImplementation(async () => undefined);
  openQuestion.mockReset();
  openQuestion.mockImplementation(async () => null);
  close.mockReset();
  reply = "REVIEW VERDICT: LGTM (head aaaaaaa)\n- nothing";
  settings = SETTINGS;
  pr = { open: true, head: HEAD, ci: "passing" };
  agent = "codex";
  prGate = null;
  sleep = async () => undefined;
  running = new Set([AUTHOR, OTHER]);
  spawned = createSpawnedSessions();
  spawned.recordSpawn(REVIEWER, AUTHOR);
  loops = new Map();
  clock_ms = 0;
});

describe("requestReview refuses before anything is sent", () => {
  it.each<[string, () => void, Req, RegExp]>([
    ["a call from outside a terminal", () => undefined, req(BODY, null), /only from a MulmoTerminal terminal/],
    ["a reviewer the caller did not start", () => spawned.recordSpawn(REVIEWER, OTHER), req(BODY), /started by another session/],
    ["a repository that declares no review", () => (settings = "owner/repo declares no review settings"), req(BODY), /declares no review settings/],
    ["a reviewer running another agent", () => (agent = "claude"), req(BODY), /declares codex as its reviewer, but session .* runs claude/],
    ["a reviewer not running here", () => (agent = undefined), req(BODY), /is not running here/],
    ["a PR gh cannot read", () => (pr = "no such PR"), req(BODY), /Could not read owner\/repo#7: no such PR/],
    ["a closed PR", () => (pr = { open: false, head: HEAD, ci: "passing" }), req(BODY), /is not open/],
    ["a malformed request", () => undefined, req({ repo: "owner/repo" }), /requestReview: /],
  ])("%s", async (_label, arrange, request, reason) => {
    arrange();
    expect(await call(routes().requestRoute, request)).toMatch(reason);
    expect(send).not.toHaveBeenCalled();
    expect(loops.size).toBe(0);
  });
});

describe("a review round", () => {
  it("sends the reviewer a tagged request, and types the merge condition into the author once it answers", async () => {
    const answer = await call(routes().requestRoute, req(BODY));
    expect(answer).toMatch(/Round 1 of owner\/repo#7 was sent/);
    expect(sentToReviewer()).toMatch(/^Review pull request #7 of owner\/repo at head a{40} .* \[sendToSession nonce000\]$/);
    expect(spawned.lastSentTo(REVIEWER)).toBe(sentToReviewer());
    await roundsEnded(1);
    expect(typedToAuthor()[0]).toMatch(/round 1\/3, reviewer codex .*LGTM on head aaaaaaa\. Merge condition met/);
    expect(loops.get("owner/repo#7")).toMatchObject({ rounds: [{ head: HEAD, verdict: "lgtm" }], running: false });
  });

  it("refuses a second round while the first runs", async () => {
    reply = null;
    const { requestRoute } = routes();
    await call(requestRoute, req(BODY));
    expect(await call(requestRoute, req(BODY))).toMatch(/still running/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("starts only one round when two requests race", async () => {
    reply = null;
    const { requestRoute } = routes();
    const answers = await Promise.all([call(requestRoute, req(BODY)), call(requestRoute, req(BODY))]);
    expect(answers.filter((answer) => /was sent/.test(answer))).toHaveLength(1);
    expect(answers.filter((answer) => /still running/.test(answer))).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("will not review a turned-down head again, and reviews the next one", async () => {
    reply = "REVIEW VERDICT: CHANGES REQUESTED (head aaaaaaa)\n- P2: x";
    const { requestRoute } = routes();
    await call(requestRoute, req(BODY));
    await roundsEnded(1);
    expect(typedToAuthor()[0]).toMatch(/CHANGES REQUESTED.*Fix them, push/);
    expect(await call(requestRoute, req(BODY))).toMatch(/push before asking again/);
    pr = { open: true, head: NEXT, ci: "pending" };
    reply = "REVIEW VERDICT: LGTM (head bbbbbbb)";
    expect(await call(requestRoute, req(BODY))).toMatch(/Round 2 of/);
    expect(sentToReviewer()).toMatch(/repeats one you raised before/);
    await roundsEnded(2);
    expect(typedToAuthor()[1]).toMatch(/round 2\/3.*1\/1 LGTM on the current head, but CI is pending/);
  });

  it("records a round whose reply opens with no verdict line as one without a verdict", async () => {
    reply = "I looked at it and it seems fine.";
    await call(routes().requestRoute, req(BODY));
    await roundsEnded(1);
    expect(typedToAuthor()[0]).toMatch(/no verdict on head/);
    expect(loops.get("owner/repo#7")?.rounds).toEqual([{ head: HEAD, verdict: null }]);
  });

  it("tells the author when the reviewer never answers", async () => {
    reply = null;
    await call(routes().requestRoute, req(BODY));
    await roundsEnded(1);
    expect(clock_ms).toBeGreaterThanOrEqual(REVIEW_WAIT_MS);
    expect(typedToAuthor()[0]).toMatch(/no answer on head.*has not answered/);
  });

  it("starts nothing when a dialog holds the reviewer, and lets the next call try again", async () => {
    send.mockImplementationOnce(async () => {
      throw new InputBlockedError();
    });
    const { requestRoute } = routes();
    expect(await call(requestRoute, req(BODY))).toMatch(/waiting on a question dialog; nothing was sent/);
    expect(loops.get("owner/repo#7")?.running).toBe(false);
    expect(await call(requestRoute, req(BODY))).toMatch(/Round 1 of/);
  });

  it("holds the result while a dialog is open in the author's session, then types it", async () => {
    let blockedTimes = 2;
    send.mockImplementation(async (session) => {
      if (session === AUTHOR && blockedTimes-- > 0) throw new InputBlockedError();
    });
    await call(routes().requestRoute, req(BODY));
    await vi.waitFor(() => expect(send.mock.calls.filter(([session]) => session === AUTHOR)).toHaveLength(3));
  });

  it("gives up on delivery after the last attempt rather than retrying forever", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    send.mockImplementation(async (session) => {
      if (session === AUTHOR) throw new InputBlockedError();
    });
    await call(routes().requestRoute, req(BODY));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(typedToAuthor()).toHaveLength(DELIVERY_ATTEMPTS);
    error.mockRestore();
  });
});

describe("an author that is gone", () => {
  it("no longer holds the PR: another session may take the review over, and the old round says nothing", async () => {
    reply = null;
    const { requestRoute } = routes();
    await call(requestRoute, req(BODY));
    // As if OTHER had started a reviewer of its own: the address check passes, and the loop decides.
    spawned.recordSpawn(REVIEWER, OTHER);
    expect(await call(requestRoute, req(BODY, OTHER))).toMatch(/Another session is running/);
    running.delete(AUTHOR);
    expect(await call(requestRoute, req(BODY, OTHER))).toMatch(/Round 1 of/);
    expect(loops.get("owner/repo#7")?.author).toBe(OTHER);
    reply = "REVIEW VERDICT: LGTM (head aaaaaaa)";
    await vi.waitFor(() => expect(send.mock.calls.filter(([session]) => session === OTHER)).toHaveLength(1));
    expect(typedToAuthor()).toEqual([]);
  });
});

describe("findings of the first review round", () => {
  it("does not count an LGTM naming another commit", async () => {
    reply = "REVIEW VERDICT: LGTM (head bbbbbbb)";
    await call(routes().requestRoute, req(BODY));
    await roundsEnded(1);
    expect(loops.get("owner/repo#7")?.rounds).toEqual([{ head: HEAD, verdict: null }]);
    expect(typedToAuthor()[0]).not.toMatch(/Merge condition met/);
  });

  it("keeps one reviewer session to one PR", async () => {
    reply = null;
    const { requestRoute } = routes();
    await call(requestRoute, req(BODY));
    expect(await call(requestRoute, req({ ...BODY, pr: 8 }))).toMatch(/already reviewing owner\/repo#7/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("holds the claim until the round's result is written, so the next round cannot slip in", async () => {
    let release = (): void => undefined;
    const { requestRoute } = routes();
    await call(requestRoute, req(BODY));
    // Only the round's own read of the PR waits; the second request's checks read it at once.
    let held = false;
    prGate = async () => {
      if (held) return;
      held = true;
      await new Promise<void>((resolve) => (release = resolve));
    };
    await vi.waitFor(() => expect(held).toBe(true));
    pr = { open: true, head: NEXT, ci: "passing" };
    expect(await call(requestRoute, req(BODY))).toMatch(/still running/);
    release();
    await roundsEnded(1);
    expect(typedToAuthor()[0]).toMatch(/round 1\/3/);
  });

  it("types nothing once endReview runs while a dialog holds the result back", async () => {
    // Real time between attempts, so endReview lands among them rather than after all of them.
    sleep = () => new Promise((resolve) => setTimeout(resolve, 2));
    send.mockImplementation(async (session) => {
      if (session === AUTHOR) throw new InputBlockedError();
    });
    const { requestRoute, endRoute } = routes();
    await call(requestRoute, req(BODY));
    await vi.waitFor(() => expect(typedToAuthor().length).toBeGreaterThan(0));
    await call(endRoute, req({ repo: "owner/repo", pr: 7 }));
    const attempts = typedToAuthor().length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(typedToAuthor().length).toBeLessThanOrEqual(attempts + 1);
    expect(typedToAuthor().length).toBeLessThan(DELIVERY_ATTEMPTS);
  });

  it("tells the author at once when the reviewer stops running, counting no round", async () => {
    reply = null;
    await call(routes().requestRoute, req(BODY));
    agent = undefined;
    await roundsEnded(1);
    expect(typedToAuthor()[0]).toMatch(/no longer running, so round 1 did not finish/);
    expect(clock_ms).toBeLessThan(REVIEW_WAIT_MS);
    expect(loops.get("owner/repo#7")).toMatchObject({ rounds: [], running: false });
  });
});

describe("endReview", () => {
  it("closes the reviewer and drops a round still running, so nothing is typed afterwards", async () => {
    reply = null;
    const { requestRoute, endRoute } = routes();
    await call(requestRoute, req(BODY));
    expect(await call(endRoute, req({ repo: "owner/repo", pr: 7 }))).toMatch(/Ended the review of owner\/repo#7 after 0 rounds/);
    expect(close).toHaveBeenCalledWith(REVIEWER);
    reply = "REVIEW VERDICT: LGTM (head aaaaaaa)";
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(typedToAuthor()).toEqual([]);
    expect(loops.size).toBe(0);
  });

  it("refuses another session's loop, and a PR with none", async () => {
    const { requestRoute, endRoute } = routes();
    await call(requestRoute, req(BODY));
    await roundsEnded(1);
    expect(await call(endRoute, req({ repo: "owner/repo", pr: 7 }, OTHER))).toMatch(/Another session/);
    expect(await call(endRoute, req({ repo: "owner/repo", pr: 8 }))).toMatch(/No review of owner\/repo#8/);
    expect(close).not.toHaveBeenCalled();
  });
});
