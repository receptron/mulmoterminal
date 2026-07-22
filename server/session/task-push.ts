// Telling the user's phone that a turn ended or is blocked. Split out of hook-routes
// because claude is no longer the only thing that finishes a turn: codex reports its
// boundaries off its rollout (no hooks exist to POST for it), and a codex turn has to
// reach the same notification, or the phone stays silent for half the grid.

import path from "node:path";
import { getPushEnabled } from "../config/config-routes.js";
import { sendWebPush } from "../infra/web-push.js";
import { HOST_ID as REMOTE_HOST_ID } from "../backends/remoteHost/index.js";
import { buildPushText, type PushKind } from "./activity-hook.js";
import { aiTitles, hiddenSessions, lastPrompts, lastResponses, ptys, translationWorkerIds } from "./registry.js";
import { sessionLastTurn } from "./session-reads.js";

const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 160;

// A finished turn should say what the agent DID — the prompt is what the user already
// knows, and reading it back tells them nothing about the outcome. Read it HERE instead
// of taking `lastResponses`: publishActivity skips its refresh for an actively-viewed
// session (no `waiting` flag) while the push still fires, and the cache deliberately
// survives a failed read — either way the map can hold the previous turn's reply, which
// is worse than saying nothing. Which log to read depends on the agent, so it goes
// through sessionLastTurn rather than assuming a claude transcript.
async function latestReply(sessionId: string, cwd: string): Promise<string | null> {
  const agent = ptys.get(sessionId)?.agent === "codex" ? "codex" : "claude";
  const turn = await sessionLastTurn(cwd, sessionId, agent);
  return turn.reply?.trim() || null;
}

// Notify the user's devices that a turn finished or is blocked, when Web Push is enabled.
// Fire-and-forget; sendWebPush no-ops when RemoteHost (its Firebase auth) isn't connected.
export async function notifyTaskFinished(sessionId: string, kind: PushKind, message: string, uiPort: string): Promise<void> {
  if (!getPushEnabled()) return;
  // Internal helper turns flow through /api/hook with active=false too — hidden background
  // workers and translation workers aren't real user tasks, so never push for them.
  if (hiddenSessions.has(sessionId) || translationWorkerIds.has(sessionId)) return;
  const cwd = ptys.get(sessionId)?.cwd ?? null;
  const where = cwd ? path.basename(cwd) : "session";
  const reply = kind === "finished" && cwd ? await latestReply(sessionId, cwd) : null;
  if (reply) lastResponses.set(sessionId, reply); // keep the roster in step; we just read it
  const detail = reply || lastPrompts.get(sessionId) || aiTitles.get(sessionId) || "";
  const { title, body } = buildPushText(kind, where, detail, message, { title: PUSH_TITLE_MAX, body: PUSH_BODY_MAX });
  // The session id is what lets the phone open this session from the notification;
  // the host id is what lets it know WHOSE session. Without it the phone opens with
  // no host selected — it never persists one — and can only offer the picker, which
  // is where every notification tap used to land (receptron/mulmoserver#86).
  // `port` is for a receiver running ON this machine, which can then open the local UI
  // directly (http://localhost:<port>). A phone cannot use it — its own localhost is the
  // phone — so the receiver has to treat it as optional and keep the existing routing.
  void sendWebPush(title, body, { sessionId, hostId: REMOTE_HOST_ID, port: uiPort });
}
