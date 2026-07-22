// The Claude hook endpoint: every Stop / Notification / Pre|PostToolUse / SessionStart
// POSTs here. One request fans out to the session's attention flags, a push to the user's
// phone, the tool-call history, the header prompt and the AI title. Split from index.ts
// (#548 step 3g) — the fan-out is what made the route long, not the route itself.
import type { Express, Request, Response } from "express";
import path from "node:path";
import { SESSION_ID_RE } from "../config/env.js";
import { getPushEnabled } from "../config/config-routes.js";
import { dirConfigWriteTarget } from "../config/dir-config.js";
import { sendWebPush } from "../infra/web-push.js";
import { HOST_ID as REMOTE_HOST_ID } from "../backends/remoteHost/index.js";
import { activityHookEffects, buildPushText, pushKindFor, resolveHookSessionId, type PushKind } from "../session/activity-hook.js";
import { aiTitles, hiddenSessions, lastPrompts, lastResponses, ptys, translationWorkerIds } from "../session/registry.js";
import { latestUserPrompt, readLatestResponse } from "../session/session-reads.js";
import { preferredHeaderPrompt } from "../session/transcript.js";
import { failPendingTranslation } from "../session/translation-worker.js";

// The header shows one line, so a longer prompt is stored truncated rather than in full.
const LAST_PROMPT_CAP = 200;

export interface HookDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  publishActivity: (id: string) => void;
  forgetTitle: (id: string) => void;
  noteTitleTurn: (id: string, prompt: string) => void;
  maybeGenerateTitle: (id: string, cwd: string | undefined) => Promise<void>;
  recordToolCallStart: (sessionId: string, call: { toolUseId?: string; toolName?: string; toolInput?: unknown }) => Promise<void>;
  recordToolCallEnd: (
    sessionId: string,
    call: { toolUseId?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown; durationMs?: number; status: "completed" | "failed" },
  ) => Promise<void>;
  /** Tell clients watching that directory to re-read its .mulmoterminal.json. */
  publishDirConfig: (cwd: string) => void;
  /** Which port this host's UI answers on, so a receiver can open it instead of guessing. */
  uiPort: string;
}

// Activity hooks update a session's working / needs-attention flags. `active` (this
// session is the user's actively-viewed pane) suppresses the attention flag — see
// activityHookEffects for why a mere attached socket doesn't count in the grid.
function handleActivityHook(deps: HookDeps, sessionId: string, event: string, active: boolean, message: string) {
  for (const eff of activityHookEffects(event, active)) {
    if (eff.kind === "working") deps.setWorking(sessionId, eff.value, event);
    else deps.setWaiting(sessionId, eff.value, event);
  }
  // Push regardless of `active` — the phone is elsewhere, unlike the attention beep.
  // A finished turn (Stop) and a blocked one (Notification) both reach here; the kind
  // decides the wording. Stop is one event per finished turn, so this fires once even
  // though a background Stop publishes twice.
  const kind = pushKindFor(event);
  if (kind) notifyTaskFinished(deps, sessionId, kind, message);
}

const PUSH_TITLE_MAX = 80;
const PUSH_BODY_MAX = 160;
// Which port this host's UI answers on, so a receiver can open it instead of guessing.
// Express serves the built SPA on PORT; under `yarn dev` the UI is Vite's own server, whose
// port the backend only knows when CLIENT_PORT is set in its environment (vite.config.ts
// defaults it separately). Reaching it still requires a receiver on this machine — see the
// data payload below.

// Notify the user's devices that a background task finished, when Web Push is enabled.
// Fire-and-forget; sendWebPush no-ops when RemoteHost (its Firebase auth) isn't connected.
function notifyTaskFinished(deps: HookDeps, sessionId: string, kind: PushKind, message: string): void {
  if (!getPushEnabled()) return;
  // Internal helper turns flow through /api/hook with active=false too — hidden background
  // workers and translation workers aren't real user tasks, so never push for them.
  if (hiddenSessions.has(sessionId) || translationWorkerIds.has(sessionId)) return;
  const cwd = ptys.get(sessionId)?.cwd ?? null;
  const where = cwd ? path.basename(cwd) : "session";
  // A finished turn should say what the agent DID — the prompt is what the user already
  // knows, and reading it back tells them nothing about the outcome. Read it HERE instead
  // of taking `lastResponses`: publishActivity skips its refresh for an actively-viewed
  // session (no `waiting` flag) while the push still fires, and the cache deliberately
  // survives a failed read — either way the map can hold the previous turn's reply, which
  // is worse than saying nothing. No reply to read falls through to the prompt.
  const reply = kind === "finished" && cwd ? readLatestResponse(sessionId, cwd) : null;
  if (reply) lastResponses.set(sessionId, reply); // keep the roster in step; we just read it
  const detail = (reply ?? "").trim() || lastPrompts.get(sessionId) || aiTitles.get(sessionId) || "";
  const { title, body } = buildPushText(kind, where, detail, message, { title: PUSH_TITLE_MAX, body: PUSH_BODY_MAX });
  // The session id is what lets the phone open this session from the notification;
  // the host id is what lets it know WHOSE session. Without it the phone opens with
  // no host selected — it never persists one — and can only offer the picker, which
  // is where every notification tap used to land (receptron/mulmoserver#86).
  // `port` is for a receiver running ON this machine, which can then open the local UI
  // directly (http://localhost:<port>). A phone cannot use it — its own localhost is the
  // phone — so the receiver has to treat it as optional and keep the existing routing.
  void sendWebPush(title, body, { sessionId, hostId: REMOTE_HOST_ID, port: deps.uiPort });
}

interface HookToolPayload {
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
  duration_ms?: number;
}

// Pre/PostToolUse hooks feed the per-session tool-call history. A failed tool
// fires PostToolUseFailure (NOT PostToolUse), so both complete the entry.
async function handleToolHook(deps: HookDeps, sessionId: string, event: string, p: HookToolPayload) {
  if (event === "PreToolUse") {
    await deps.recordToolCallStart(sessionId, { toolUseId: p.tool_use_id, toolName: p.tool_name, toolInput: p.tool_input });
  } else if (event === "PostToolUse" || event === "PostToolUseFailure") {
    await deps.recordToolCallEnd(sessionId, {
      toolUseId: p.tool_use_id,
      toolName: p.tool_name,
      toolInput: p.tool_input,
      toolOutput: p.tool_output ?? p.tool_response,
      durationMs: p.duration_ms,
      status: event === "PostToolUseFailure" ? "failed" : "completed",
    });
  }
  // A SUCCESSFUL write to <dir>/.mulmoterminal.json is the live-reload signal: the hook that already
  // reports every tool call tells the client to re-read that directory's config, so no fs watchers.
  if (event === "PostToolUse") {
    const cwd = dirConfigWriteTarget(p.tool_name, p.tool_input, ptys.get(sessionId)?.cwd ?? null);
    if (cwd) deps.publishDirConfig(cwd);
  }
}

// Track the prompt the cell header shows for a session, from a UserPromptSubmit
// hook. On the FIRST live prompt after a (re)start/resume the in-memory baseline is
// empty, so seed it from the transcript's meaningful prompt — otherwise a trivial
// ack ("ok") would overwrite the restored task. (Brand-new sessions have no
// transcript yet => null => the new prompt becomes the first shown.) Then keep the
// last MEANINGFUL prompt (preferredHeaderPrompt) while still tracking the latest for
// an all-trivial session.
async function trackPromptForHeader(sessionId: string, prompt: string, cwd: string | undefined) {
  if (!lastPrompts.has(sessionId)) {
    const seeded = cwd ? await latestUserPrompt(cwd, sessionId) : null;
    if (seeded) lastPrompts.set(sessionId, seeded);
  }
  lastPrompts.set(sessionId, preferredHeaderPrompt(lastPrompts.get(sessionId) ?? null, prompt));
}

// `/clear` restarts the conversation, so the header must stop showing the pre-clear prompt. Blank it
// (empty string beats the `?? transcriptPrompt` fallback in /api/session, so the old transcript can't
// resurface) and publish; the next UserPromptSubmit sets the new query. `forgetTitle` drops the AI title
// so it's regenerated fresh on the next turn (leaving it in `aiTitles` — even as "" — would read as
// "already titled" and suppress that regeneration). The cockpit's last reply is blanked the same way as
// the prompt (empty beats `?? transcriptResponse`) so it can't show the pre-clear answer.
function clearHeaderPrompt(deps: HookDeps, sessionId: string): void {
  lastPrompts.set(sessionId, "");
  lastResponses.set(sessionId, "");
  deps.forgetTitle(sessionId);
  deps.publishActivity(sessionId);
}

// Header-prompt / AI-title side effects of a hook, per event: track the submitted prompt
// (UserPromptSubmit), drop it on `/clear` (SessionStart source=clear), or (re)generate the
// AI title once a turn's reply is on disk (Stop). Kept out of the route so its branching
// doesn't inflate the handler. Runs before handleActivityHook so the activity publish it
// triggers already carries the new lastPrompt.
async function applyHeaderHooks(deps: HookDeps, sessionId: string, event: string, body: Record<string, unknown>, cwd: string | undefined): Promise<void> {
  if (event === "UserPromptSubmit" && typeof body.prompt === "string" && body.prompt.trim()) {
    const prompt = body.prompt.trim().slice(0, LAST_PROMPT_CAP);
    await trackPromptForHeader(sessionId, prompt, cwd);
    deps.noteTitleTurn(sessionId, prompt);
  } else if (event === "SessionStart" && body.source === "clear") {
    clearHeaderPrompt(deps, sessionId);
  } else if (event === "Stop") {
    void deps.maybeGenerateTitle(sessionId, cwd);
  }
}

// Claude hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
async function handleHookRequest(deps: HookDeps, req: Request, res: Response) {
  const body = req.body || {};
  const sessionId = resolveHookSessionId(req.headers["x-mt-session"], body.session_id, (id) => SESSION_ID_RE.test(id));
  const event = body.hook_event_name;
  if (!sessionId && body.session_id) {
    // Rejecting silently would make hooks look simply broken; the id shape is the
    // precondition for using it as a Firestore doc id and as push routing.
    console.warn(`[hook] ignoring ${event} — session id is not a canonical uuid`);
  }
  if (sessionId) {
    const entry = ptys.get(sessionId);
    const active = !!(entry && entry.active);
    const cwd = typeof body.cwd === "string" ? body.cwd : entry?.cwd;
    await applyHeaderHooks(deps, sessionId, event, body, cwd);
    handleActivityHook(deps, sessionId, event, active, typeof body.message === "string" ? body.message : "");
    await handleToolHook(deps, sessionId, event, body);
    // A hidden translation worker that ends its turn while still pending never called
    // submitTranslation — fail it now rather than hang until the timeout. (When it DID
    // submit, the entry is already resolved and this reject is a no-op.)
    if (event === "Stop") failPendingTranslation(sessionId, "[translation] worker ended its turn without calling submitTranslation");
    console.log(`[hook] ${event} for ${sessionId}`);
  }
  res.json({ ok: true });
}

export function mountHookRoute(app: Express, deps: HookDeps) {
  // Claude hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
  // we can flag which background sessions have new activity / build tool history.
  // Return the promise rather than dropping it: express 5 forwards a rejected handler
  // to its error middleware, and swallowing it here would turn a failed hook into an
  // unhandled rejection instead of a 500.
  app.post("/api/hook", (req, res) => handleHookRequest(deps, req, res));
}
