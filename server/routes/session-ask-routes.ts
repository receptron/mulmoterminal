// The routes behind sendToSession and waitForSessionReply (#3404): an agent types into a session it
// started, and reads what that session answered. Host tools, before the plugin catch-all.
//
// The caller comes from the MCP broker's header, and the target must be a session the caller started
// (routes/sessionAsk.ts), so an agent using these tools cannot reach the other cells the user has
// open. The header is an assertion, not a credential: this limits the TOOLS. A local process can
// already type into any session through POST /api/terminal/:id/reply, which takes no header at all.
import type { Express, Request, Response } from "express";
import type { AskQuestionEvent } from "../../common/askQuestion.js";
import type { TurnSnapshot } from "../../common/turnCorrelation.js";
import { InputBlockedError, type SendOptions } from "../backends/remoteHost/terminalInput.js";
import { SESSION_HEADER, sessionIdFromHeader } from "../backends/files/presentPathRoot.js";
import type { SpawnedSessions } from "../session/spawned-sessions.js";
import { messageOf } from "../errors.js";
import { inputHeld } from "./deliverWhenFree.js";
import { addressRefusal, askTag, awaitReply, parseSendRequest, parseWaitRequest, replyMessage } from "./sessionAsk.js";

export interface SessionAskRouteDeps {
  spawned: SpawnedSessions;
  /** Resolves once the Enter has gone out; rejects with InputBlockedError when `blocked` says no. */
  send: (sessionId: string, text: string, options: SendOptions) => Promise<unknown>;
  openQuestion: (sessionId: string) => Promise<AskQuestionEvent | null>;
  /** The agent reported a permission prompt it is still waiting on (deliverWhenFree.ts). */
  permissionPending: (sessionId: string) => boolean;
  /** A reader for the session's last completed turn, or why it cannot be read. */
  turnReader: (sessionId: string) => (() => Promise<TurnSnapshot>) | string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** A fresh tag per send (askTag). */
  nonce: () => string;
}

/** The calling session and the target it may address, or null once the refusal has been answered. */
function addressed(req: Request, res: Response, tool: string, target: string, spawned: SpawnedSessions): string | null {
  const caller = sessionIdFromHeader(req.get(SESSION_HEADER));
  if (!caller) {
    res.json({ message: `${tool} works only from a MulmoTerminal terminal.` });
    return null;
  }
  const refusal = addressRefusal(caller, target, spawned.parentOf);
  if (refusal !== null) {
    res.json({ message: refusal });
    return null;
  }
  return caller;
}

/** A dialog that opened after the paste leaves the line in the input box, where the user may still
 *  submit it — so it is remembered for the wait, and the caller is told it is there. */
function blockedMessage(session: string, err: InputBlockedError, remember: () => void): string {
  if (!err.afterPaste) return `Session ${session} is waiting on a question dialog or a permission prompt; nothing was sent.`;
  remember();
  return `Session ${session} opened a question dialog or a permission prompt before Enter: your text is in its input box, not submitted.`;
}

function mountSend(app: Express, deps: SessionAskRouteDeps): void {
  app.post("/api/plugin/sendToSession", async (req, res) => {
    const request = parseSendRequest(req.body);
    if (!request.ok) return res.json({ message: `sendToSession: ${request.error}` });
    if (addressed(req, res, "sendToSession", request.session, deps.spawned) === null) return;
    // Asked inside the sender's chain, before the paste and again before the Enter: a dialog can
    // open while this send waits its turn.
    const blocked = async (): Promise<boolean> => inputHeld(deps, request.session);
    const sent = `${request.message}${askTag(deps.nonce())}`;
    try {
      await deps.send(request.session, sent, { blocked });
    } catch (err) {
      if (err instanceof InputBlockedError)
        return res.json({ message: blockedMessage(request.session, err, () => deps.spawned.rememberSent(request.session, sent)) });
      return res.json({ message: `Could not send to session ${request.session}: ${messageOf(err)}` });
    }
    deps.spawned.rememberSent(request.session, sent);
    return res.json({ message: `Sent to session ${request.session}. Call waitForSessionReply to read its answer.` });
  });
}

function mountWait(app: Express, deps: SessionAskRouteDeps): void {
  app.post("/api/plugin/waitForSessionReply", async (req, res) => {
    const request = parseWaitRequest(req.body);
    if (!request.ok) return res.json({ message: `waitForSessionReply: ${request.error}` });
    if (addressed(req, res, "waitForSessionReply", request.session, deps.spawned) === null) return;
    const sent = deps.spawned.lastSentTo(request.session);
    if (sent === undefined) return res.json({ message: `Nothing has been sent to session ${request.session} yet; call sendToSession first.` });
    const readTurn = deps.turnReader(request.session);
    if (typeof readTurn === "string") return res.json({ message: readTurn });
    // Before a response is written, "close" means the caller hung up.
    let hungUp = false;
    res.on("close", () => (hungUp = true));
    try {
      const wait = await awaitReply(sent, request.waitMs, { readTurn, sleep: deps.sleep, now: deps.now, isAborted: () => hungUp });
      if (!hungUp) res.json({ message: replyMessage(request.session, wait) });
    } catch (err) {
      if (!hungUp) res.json({ message: `Could not read session ${request.session}'s reply: ${messageOf(err)}` });
    }
  });
}

export function mountSessionAskRoutes(app: Express, deps: SessionAskRouteDeps): void {
  mountSend(app, deps);
  mountWait(app, deps);
}
