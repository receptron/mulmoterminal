// Telling the user's phone that a turn ended or is blocked. Split out of hook-routes
// because claude is no longer the only thing that finishes a turn: codex reports its
// boundaries off its rollout (no hooks exist to POST for it), and a codex turn has to
// reach the same notification, or the phone stays silent for half the grid.

import { getPushEnabled, getPushKinds } from "../../config/config-routes.js";
import { sendWebPush } from "../../infra/http/web-push.js";
import { currentHostId as currentRemoteHostId } from "../../backends/remoteHost/index.js";
import { buildPushText } from "./activity-hook.js";
import type { PushKind } from "../../../common/pushKinds.js";
import { asTerminalAgent } from "../../../common/sessionAgent.js";
import { aiTitles, lastResponses, ptys, pushClassification, translationWorkerIds } from "../registry.js";
import { transcriptIdOf } from "../transcript/cleared-transcripts.js";
import { antigravityCurrentTurnReply, claudeCurrentTurnReply, copilotCurrentTurnReply, sessionLastTurn, LAST_RESPONSE_MAX } from "../session-reads.js";
import { buildPushDetail, pushWhere, shouldSuppressPush, wantsPushKind } from "./taskPushRules.js";

const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 160;

/** What the event that triggered this push already carried, so the body doesn't have to be
 *  reconstructed from a file the event has outrun. */
export interface PushHookText {
  /** The Notification hook's own text ("Claude needs your permission"). Empty for a finished
   *  turn, and for codex, which reaches this from a rollout rather than a hook. */
  message: string;
  /** Stop's `last_assistant_message`: the reply the turn ended with, from the very event that
   *  reports the turn ending. Absent on a Claude Code that doesn't send it, and on every other
   *  agent. */
  reply?: string | undefined;
}

// A finished turn should say what the agent DID — the prompt is what the user already
// knows, and reading it back tells them nothing about the outcome. Read it HERE instead
// of taking `lastResponses`: publishActivity skips its refresh for an actively-viewed
// session (no `waiting` flag) while the push still fires, and the cache deliberately
// survives a failed read — either way the map can hold the previous turn's reply, which
// is worse than saying nothing. Which log to read depends on the agent, so it goes
// through session-reads rather than assuming a claude transcript.
//
// Claude, Antigravity and copilot are asked for THIS turn's reply rather than the last complete
// exchange: a turn the user interrupted, or one that ended on a tool call, has no reply, and
// sessionLastTurn answers such a turn with the PREVIOUS one's (#1650). Every other agent keeps that
// read, for the reason given at claudeCurrentTurnReply.
async function latestReply(sessionId: string, transcriptId: string, cwd: string): Promise<string | null> {
  const agent = asTerminalAgent(ptys.get(sessionId)?.agent);
  if (agent === "claude") return capped(await claudeCurrentTurnReply(cwd, transcriptId));
  if (agent === "antigravity") return capped(await antigravityCurrentTurnReply(sessionId));
  if (agent === "copilot") return capped(await copilotCurrentTurnReply(cwd, sessionId));
  return capped((await sessionLastTurn(cwd, sessionId, agent)).reply);
}

// Capped like every other writer of lastResponses — the map is declared as holding truncated
// text, and it is served in the roster payload for every listed session.
function capped(text: string | null | undefined): string | null {
  const reply = text?.trim();
  return reply ? reply.slice(0, LAST_RESPONSE_MAX) : null;
}

// What the finished turn actually said. The hook's own `last_assistant_message` is the same fact
// the read below reconstructs, from the event that reports the turn — so it cannot race the
// transcript write, guess the wrong project directory, or miss a session id claude reissued.
//
// It is asked FIRST and asked without either gate: a session with no cwd, and one that moved with
// nowhere recorded (#1085), both still get a correct answer here, because the value never came from
// a file (#1696). Otherwise the read follows the session to the transcript it is in now.
async function finishedReply(sessionId: string, cwd: string | null, hookReply: string | undefined): Promise<string | null> {
  const fromHook = capped(hookReply);
  if (fromHook) return fromHook;
  const transcriptId = transcriptIdOf(sessionId);
  if (!cwd || transcriptId === null) return null;
  return latestReply(sessionId, transcriptId, cwd);
}

// Notify the user's devices that a turn finished or is blocked, when Web Push is enabled.
// Fire-and-forget; sendWebPush no-ops when RemoteHost (its Firebase auth) isn't connected.
export async function notifyTaskFinished(sessionId: string, kind: PushKind, hookText: PushHookText, uiPort: string): Promise<void> {
  if (!wantsPushKind(getPushEnabled(), getPushKinds(), kind)) return;
  // Internal helper turns flow through /api/hook with active=false too — the suppression gate
  // keeps those (background workers, translation workers) from ever reaching the phone. Asked
  // of the DURABLE predicate, not the live set: tmux keeps a worker's agent running across a
  // server restart, and the live set does not survive one — so the gate would open for exactly
  // the long-running scheduled refresh it exists to silence.
  // Both durable answers from one call, so they cannot be read at different points of hydration —
  // see pushClassification for why that combination is the dangerous one.
  const { background, userScheduled } = await pushClassification(sessionId);
  if (shouldSuppressPush(background, translationWorkerIds.has(sessionId), userScheduled)) return;
  const cwd = ptys.get(sessionId)?.cwd ?? null;
  const where = pushWhere(cwd);
  const readFrom = transcriptIdOf(sessionId);
  const reply = kind === "finished" ? await finishedReply(sessionId, cwd, hookText.reply) : null;
  // Keep the roster in step, unless the session moved while that ran and the reply is from before.
  if (reply && transcriptIdOf(sessionId) === readFrom) lastResponses.set(sessionId, reply);
  const detail = buildPushDetail({ reply, aiTitle: aiTitles.get(sessionId) });
  const { title, body } = buildPushText(kind, where, detail, hookText.message, { title: PUSH_TITLE_MAX, body: PUSH_BODY_MAX });
  // The session id is what lets the phone open this session from the notification;
  // the host id is what lets it know WHOSE session. Without it the phone opens with
  // no host selected — it never persists one — and can only offer the picker, which
  // is where every notification tap used to land (receptron/mulmoserver#86).
  // `port` is for a receiver running ON this machine, which can then open the local UI
  // directly (http://localhost:<port>). A phone cannot use it — its own localhost is the
  // phone — so the receiver has to treat it as optional and keep the existing routing.
  // No host id before this machine's channel is decided for the account: the tap then
  // opens the phone's picker rather than a channel that may belong to another machine.
  const hostId = currentRemoteHostId();
  void sendWebPush(title, body, { sessionId, ...(hostId ? { hostId } : {}), port: uiPort });
}
