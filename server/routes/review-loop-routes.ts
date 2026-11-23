// The routes behind requestReview and endReview (#3409): the server runs one review round at a time
// between a session and the reviewer session it started, and types how each round ended into the
// author's session. The progress — which round, which head got which verdict — lives here, not in
// either agent's context. It never merges (#1183): it tells the author when the merge condition is met.
//
// Host tools before the plugin catch-all. Addressing is sendToSession's rule: the reviewer must be a
// session the caller started (routes/sessionAsk.ts), and the header naming the caller is an assertion.
import type { Express, Request, Response } from "express";
import type { ReviewSettings } from "../../common/reviewSettings.js";
import { InputBlockedError, sanitizeTerminalInput } from "../backends/remoteHost/terminalInput.js";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/files/presentPathRoot.js";
import { parseVerdictLine } from "../git/codexVerdict.js";
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
  type ReviewLoop,
  type ReviewRound,
} from "./reviewLoop.js";

// A dialog open in the author's session holds the round's result back; it is offered again until then.
export const DELIVERY_RETRY_MS = 5000;
export const DELIVERY_ATTEMPTS = 120;

export interface ReviewLoopRouteDeps extends SessionAskRouteDeps {
  loops: Map<string, ReviewLoop>;
  /** The repository's declared review settings, or why there are none to run a loop with. */
  settingsOf: (repo: string) => Promise<ReviewSettings | string>;
  prState: (repo: string, pr: number) => Promise<PrReviewState | string>;
  /** The agent a session running here is, or undefined when it is not running here. */
  agentOf: (session: string) => string | undefined;
  /** End the session and close its cell. */
  close: (session: string) => void;
}

function callerOf(req: Request, res: Response, tool: string): string | null {
  const caller = sessionIdFromHeader(req.get(SESSION_HEADER));
  if (!caller) res.json({ message: `${tool} works only from a MulmoTerminal terminal.` });
  return caller ?? null;
}

/** The result of a round, typed into the author's session once nothing holds its input. */
async function deliver(deps: ReviewLoopRouteDeps, author: string, text: string): Promise<void> {
  const blocked = async (): Promise<boolean> => (await deps.openQuestion(author)) !== null;
  for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
    try {
      await deps.send(author, sanitizeTerminalInput(text), { blocked });
      return;
    } catch (err) {
      // After the paste the text is already in the input box, where the user can see and submit it.
      if (!(err instanceof InputBlockedError) || err.afterPaste) return;
      await deps.sleep(DELIVERY_RETRY_MS);
    }
  }
  console.error(`[requestReview] a dialog in session ${author} kept the review result from being typed.`);
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

const verdictOf = (wait: ReplyWait): ReviewRound["verdict"] =>
  wait.status === "answered" ? (parseVerdictLine(wait.reply.trimStart())?.verdict ?? null) : null;

/** Waits for the reviewer in the background, records the round and tells the author — unless the
 *  loop was ended meanwhile, when nobody is waiting for the result. */
async function runRound(deps: ReviewLoopRouteDeps, run: RoundRun): Promise<void> {
  const { loop, settings, head } = run;
  const key = loopKey(loop);
  const ended = (): boolean => deps.loops.get(key) !== loop;
  const wait = await reviewerAnswer(deps, run, ended);
  if (ended() || (typeof wait !== "string" && wait.status === "aborted")) return;
  loop.running = false;
  if (typeof wait === "string") return deliver(deps, loop.author, `[requestReview] ${loop.repo}#${loop.pr}: could not read the reviewer's reply: ${wait}`);
  loop.rounds.push({ head, verdict: verdictOf(wait) });
  const pr = await deps.prState(loop.repo, loop.pr);
  await deliver(deps, loop.author, roundEndMessage({ loop, settings, now: typeof pr === "string" ? null : pr, timedOut: wait.status === "waiting" }));
}

/** The PR's loop, unless the session that ran it is no longer running here — a closed or crashed
 *  author would otherwise hold the PR until a restart. Dropping it also abandons its round. */
function liveLoop(deps: ReviewLoopRouteDeps, key: string): ReviewLoop | undefined {
  const loop = deps.loops.get(key);
  if (loop === undefined || deps.agentOf(loop.author) !== undefined) return loop;
  deps.loops.delete(key);
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
      ? `Reviewer session ${reviewer} opened a question dialog before Enter: the review request is in its input box, not submitted. Answer the dialog there, then call requestReview again.`
      : `Reviewer session ${reviewer} is waiting on a question dialog; nothing was sent.`;
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
  const refusal = roundRefusal(existing, { author: caller, reviewer: request.reviewer, head: checked.head }, checked.settings);
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
    const sent = `${reviewPrompt({ ...request, head: checked.head, round, maxRounds: checked.settings.maxRounds })}${askTag(deps.nonce())}`;
    const blocked = async (): Promise<boolean> => (await deps.openQuestion(request.reviewer)) !== null;
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
    try {
      deps.close(loop.reviewer);
    } catch (err) {
      return res.json({ message: `Ended the review of ${loop.repo}#${loop.pr}, but reviewer session ${loop.reviewer} could not be closed: ${messageOf(err)}` });
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
