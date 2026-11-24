// The routes behind requestReview and endReview (#3409): the server runs one review round at a time
// between a session and the reviewer session it started, and types how each round ended into the
// author's session. The progress — which round, which head got which verdict — lives here, not in
// either agent's context. It never merges (#1183): it tells the author when the merge condition is met.
//
// Host tools before the plugin catch-all. Addressing is sendToSession's rule: the reviewer must be a
// session the caller started (routes/sessionAsk.ts), and the header naming the caller is an assertion.
import type { Express, Request, Response } from "express";
import type { ReviewSettings } from "../../common/reviewSettings.js";
import { InputBlockedError } from "../backends/remoteHost/terminalInput.js";
import { deliverWhenFree, inputHeld } from "./deliverWhenFree.js";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/files/presentPathRoot.js";
import type { PrReviewState } from "../git/pr-review-state.js";
import { messageOf } from "../errors.js";
import type { SessionAskRouteDeps } from "./session-ask-routes.js";
import { addressRefusal, askTag, awaitReply, type ReplyWait } from "./sessionAsk.js";
import {
  loopKey,
  parseEndRequest,
  parseReviewRequest,
  REVIEW_WAIT_MINUTES,
  REVIEW_WAIT_MS,
  reviewPrompt,
  roundEndMessage,
  roundRefusal,
  reviewerGoneMessage,
  reviewerRefusal,
  verdictFor,
  type ReviewLoop,
} from "./reviewLoop.js";

export interface ReviewLoopRouteDeps extends SessionAskRouteDeps {
  loops: Map<string, ReviewLoop>;
  /** The repository's declared review settings, or why there are none to run a loop with. */
  settingsOf: (repo: string) => Promise<ReviewSettings | string>;
  prState: (repo: string, pr: number) => Promise<PrReviewState | string>;
  /** The agent a session running here is, or undefined when it is not running here. */
  agentOf: (session: string) => string | undefined;
  /** End the session and close its cell; false when its tmux session is still there. */
  close: (session: string) => boolean;
}

function callerOf(req: Request, res: Response, tool: string): string | null {
  const caller = sessionIdFromHeader(req.get(SESSION_HEADER));
  if (!caller) res.json({ message: `${tool} works only from a MulmoTerminal terminal.` });
  return caller ?? null;
}

interface RoundRun {
  loop: ReviewLoop;
  settings: ReviewSettings;
  head: string;
  sent: string;
  readTurn: Exclude<ReturnType<SessionAskRouteDeps["turnReader"]>, string>;
}

/** The reviewer's answer to `sent`, or why it could not be read. */
async function reviewerAnswer(deps: ReviewLoopRouteDeps, run: RoundRun, ended: () => boolean): Promise<ReplyWait | string> {
  try {
    return await awaitReply(run.sent, REVIEW_WAIT_MS, { readTurn: run.readTurn, sleep: deps.sleep, now: deps.now, isAborted: ended });
  } catch (err) {
    return messageOf(err);
  }
}

/** What the author is told about the round, recorded first. The loop stays claimed meanwhile, so a
 *  next round cannot append before this one is described. */
async function roundResult(deps: ReviewLoopRouteDeps, run: RoundRun, wait: ReplyWait | string): Promise<string> {
  const { loop, settings, head } = run;
  if (typeof wait === "string") return `[requestReview] ${loop.repo}#${loop.pr}: could not read the reviewer's reply: ${wait}`;
  if (wait.status === "aborted") return reviewerGoneMessage(loop);
  loop.rounds.push({ head, verdict: wait.status === "answered" ? verdictFor(wait.reply, head) : null });
  const pr = await deps.prState(loop.repo, loop.pr);
  return roundEndMessage({ loop, settings, now: typeof pr === "string" ? null : pr, timedOut: wait.status === "waiting" });
}

/** Waits for the reviewer in the background, records the round and tells the author — unless the
 *  loop was ended meanwhile, when nobody is waiting for the result. A reviewer that stops running
 *  ends the wait at once rather than after the whole timeout. */
async function runRound(deps: ReviewLoopRouteDeps, run: RoundRun): Promise<void> {
  const { loop } = run;
  const key = loopKey(loop);
  const ended = (): boolean => deps.loops.get(key) !== loop;
  const wait = await reviewerAnswer(deps, run, () => ended() || deps.agentOf(loop.reviewer) === undefined);
  if (ended()) return;
  const text = await roundResult(deps, run, wait);
  if (ended()) return;
  loop.running = false;
  await deliverWhenFree(deps, loop.author, text, ended, "requestReview");
}

/** The PR's loop, unless the session that ran it is no longer running here — a closed or crashed
 *  author would otherwise hold the PR until a restart. Dropping it abandons its round and closes its
 *  reviewer, which only that author could address. */
function liveLoop(deps: ReviewLoopRouteDeps, key: string): ReviewLoop | undefined {
  const loop = deps.loops.get(key);
  if (loop === undefined || deps.agentOf(loop.author) !== undefined) return loop;
  deps.loops.delete(key);
  try {
    if (!deps.close(loop.reviewer)) console.error(`[requestReview] reviewer session ${loop.reviewer} of ${key} is still running after close.`);
  } catch (err) {
    console.error(`[requestReview] could not close reviewer session ${loop.reviewer} of ${key}: ${messageOf(err)}`);
  }
  return undefined;
}

/** Everything that must hold before a round is sent, or the refusal to answer with. */
async function roundCheck(
  deps: ReviewLoopRouteDeps,
  caller: string,
  request: { repo: string; pr: number; reviewer: string },
): Promise<string | { settings: ReviewSettings; head: string }> {
  const refusal = addressRefusal(caller, request.reviewer, deps.spawned.parentOf);
  if (refusal !== null) return refusal;
  const settings = await deps.settingsOf(request.repo);
  if (typeof settings === "string") return settings;
  const agent = deps.agentOf(request.reviewer);
  if (agent !== settings.reviewer) {
    const running = agent === undefined ? "is not running here" : `runs ${agent}`;
    return `${request.repo} declares ${settings.reviewer} as its reviewer, but session ${request.reviewer} ${running}.`;
  }
  const pr = await deps.prState(request.repo, request.pr);
  if (typeof pr === "string") return `Could not read ${request.repo}#${request.pr}: ${pr}`;
  if (!pr.open) return `${request.repo}#${request.pr} is not open.`;
  const loopRefusal = roundRefusal(liveLoop(deps, loopKey(request)), { author: caller, reviewer: request.reviewer, head: pr.head }, settings);
  return loopRefusal ?? { settings, head: pr.head };
}

function sendFailure(reviewer: string, err: unknown): string {
  if (err instanceof InputBlockedError)
    return err.afterPaste
      ? `Reviewer session ${reviewer} opened a question dialog or a permission prompt before Enter: the review request is in its input box, not submitted. Answer the dialog there, then call requestReview again.`
      : `Reviewer session ${reviewer} is waiting on a question dialog or a permission prompt; nothing was sent.`;
  return `Could not send to reviewer session ${reviewer}: ${messageOf(err)}`;
}

/** Marks the PR's loop as running, asked again with no await before it: two calls that both passed
 *  roundCheck while it read gh must not both send a round. */
function claimRound(
  deps: ReviewLoopRouteDeps,
  caller: string,
  request: { repo: string; pr: number; reviewer: string },
  checked: { settings: ReviewSettings; head: string },
): ReviewLoop | string {
  const key = loopKey(request);
  const existing = liveLoop(deps, key);
  const refusal =
    roundRefusal(existing, { author: caller, reviewer: request.reviewer, head: checked.head }, checked.settings) ??
    reviewerRefusal(deps.loops.values(), request, request.reviewer);
  if (refusal !== null) return refusal;
  const loop = existing ?? { repo: request.repo, pr: request.pr, author: caller, reviewer: request.reviewer, rounds: [], running: false };
  loop.running = true;
  deps.loops.set(key, loop);
  return loop;
}

function mountRequest(app: Express, deps: ReviewLoopRouteDeps): void {
  app.post("/api/plugin/requestReview", async (req, res) => {
    const request = parseReviewRequest(req.body);
    if (!request.ok) return res.json({ message: `requestReview: ${request.error}` });
    const caller = callerOf(req, res, "requestReview");
    if (caller === null) return;
    const checked = await roundCheck(deps, caller, request);
    if (typeof checked === "string") return res.json({ message: checked });
    const readTurn = deps.turnReader(request.reviewer);
    if (typeof readTurn === "string") return res.json({ message: readTurn });
    const loop = claimRound(deps, caller, request, checked);
    if (typeof loop === "string") return res.json({ message: loop });
    const key = loopKey(loop);
    const round = loop.rounds.length + 1;
    const sent = `${reviewPrompt({ ...request, head: checked.head, round, maxRounds: checked.settings.maxRounds, skill: checked.settings.skill })}${askTag(deps.nonce())}`;
    const blocked = async (): Promise<boolean> => inputHeld(deps, request.reviewer);
    try {
      await deps.send(request.reviewer, sent, { blocked });
    } catch (err) {
      loop.running = false;
      return res.json({ message: sendFailure(request.reviewer, err) });
    }
    deps.spawned.rememberSent(request.reviewer, sent);
    runRound(deps, { loop, settings: checked.settings, head: checked.head, sent, readTurn }).catch((err: unknown) =>
      console.error(`[requestReview] round ${round} of ${key} failed: ${messageOf(err)}`),
    );
    return res.json({
      message: `Round ${round} of ${request.repo}#${request.pr} was sent to reviewer session ${request.reviewer}. How it ends will be typed into this session (the reviewer has up to ${REVIEW_WAIT_MINUTES} minutes); you do not need to wait or poll.`,
    });
  });
}

function mountEnd(app: Express, deps: ReviewLoopRouteDeps): void {
  app.post("/api/plugin/endReview", (req, res) => {
    const request = parseEndRequest(req.body);
    if (!request.ok) return res.json({ message: `endReview: ${request.error}` });
    const caller = callerOf(req, res, "endReview");
    if (caller === null) return;
    const key = loopKey(request);
    const loop = deps.loops.get(key);
    if (loop === undefined) return res.json({ message: `No review of ${request.repo}#${request.pr} is running.` });
    if (loop.author !== caller) return res.json({ message: `Another session is running the review of ${loop.repo}#${loop.pr}.` });
    deps.loops.delete(key);
    const notClosed = `Ended the review of ${loop.repo}#${loop.pr}, but reviewer session ${loop.reviewer} could not be closed`;
    try {
      if (!deps.close(loop.reviewer)) return res.json({ message: `${notClosed}: it is still running. Close its cell by hand.` });
    } catch (err) {
      return res.json({ message: `${notClosed}: ${messageOf(err)}` });
    }
    return res.json({
      message: `Ended the review of ${loop.repo}#${loop.pr} after ${loop.rounds.length} rounds and closed reviewer session ${loop.reviewer}.`,
    });
  });
}

export function mountReviewLoopRoutes(app: Express, deps: ReviewLoopRouteDeps): void {
  mountRequest(app, deps);
  mountEnd(app, deps);
}
