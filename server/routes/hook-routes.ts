// The Claude hook endpoint: every Stop / Notification / Pre|PostToolUse / SessionStart
// POSTs here. One request fans out to the session's attention flags, a push to the user's
// phone, the tool-call history, the header prompt and the AI title. Split from index.ts
// (#548 step 3g) — the fan-out is what made the route long, not the route itself.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { isRecord } from "../../common/isRecord.js";
import { dirConfigWriteTarget } from "../config/dir-config.js";
import { writtenFilePath } from "../files/tool-writes.js";
import { activityHookEffects, pushKindFor, resolveHookCwd, resolveHookSessionId } from "../session/activity-hook.js";
import { runCompletionHook } from "../session/completion-hooks.js";
import { messageOf } from "../errors.js";
import { headerHookEffect } from "../session/header-hook.js";
import { noteLiveCwd } from "../session/live-cwd.js";
import { lastPrompts, lastResponses, ptys } from "../session/registry.js";
import { clearedTranscripts, markTranscriptCleared } from "../session/cleared-transcripts.js";
import { latestUserPrompt } from "../session/session-reads.js";
import { notifyTaskFinished } from "../session/task-push.js";
import { preferredHeaderPrompt } from "../session/transcript.js";
import { failPendingTranslation } from "../session/translation-worker.js";
import type { SessionActivityDeps } from "../session/session-activity-deps.js";
import { publishesDirConfig, toolHookRecord, type ToolCallEnd, type ToolCallStart, type ToolHookPayload } from "../session/tool-hook.js";

// The header shows one line, so a longer prompt is stored truncated rather than in full.

export interface HookDeps extends SessionActivityDeps {
  recordToolCallStart: (sessionId: string, call: ToolCallStart) => Promise<void>;
  recordToolCallEnd: (sessionId: string, call: ToolCallEnd) => Promise<void>;
  /** Tell clients watching that directory to re-read its .mulmoterminal.json. */
  publishDirConfig: (cwd: string) => void;
  publishFileWrite: (file: string) => void;
  /** Which port this host's UI answers on, so a receiver can open it instead of guessing. */
  uiPort: string;
}

// Activity hooks update a session's working / needs-attention flags. `active` (this
// session is the user's actively-viewed pane) suppresses the attention flag — see
// activityHookEffects for why a mere attached socket doesn't count in the grid.
function handleActivityHook(deps: HookDeps, sessionId: string, event: string, active: boolean, message: string, notificationType?: string) {
  for (const eff of activityHookEffects(event, active, notificationType)) {
    if (eff.kind === "working") deps.setWorking(sessionId, eff.value, event);
    else deps.setWaiting(sessionId, eff.value, event);
  }
  // Push regardless of `active` — the phone is elsewhere, unlike the attention beep.
  // A finished turn (Stop) and a blocked one (Notification) both reach here; the kind
  // decides the wording. Stop is one event per finished turn, so this fires once even
  // though a background Stop publishes twice.
  const kind = pushKindFor(event, notificationType);
  if (kind) void notifyTaskFinished(sessionId, kind, message, deps.uiPort);
  // A finished turn is the ONLY success signal a PTY-hosted agent gives us (#1070). It is not
  // a process exit — `claude` sits at its prompt afterwards — so a worker that never reaches
  // Stop (blocked on a permission dialog nobody can answer, or dead before its first turn) is
  // exactly the failed refresh, and reap reports it as such. No-op unless a hook is registered,
  // which a hidden feeds worker does — and, since #1188, a hidden CLAUDE spawnBackgroundChat.
  // Only claude: this endpoint is Claude Code's hook mechanism, so it is the only agent that can
  // ever reach here to report success, and a hook registered for another one could only ever
  // report failure.
  if (event === "Stop") void runCompletionHook(sessionId, { didError: false }).catch((err) => console.error(`[completion-hook] ${messageOf(err)}`));
}

// The tool fields of a hook body. Read rather than trusted: the payload is whatever the hook
// POSTed, and the `unknown` fields are forwarded to toolHookRecord without being opened here.
const toolPayload = (body: Record<string, unknown>): ToolHookPayload => ({
  tool_use_id: typeof body.tool_use_id === "string" ? body.tool_use_id : undefined,
  tool_name: typeof body.tool_name === "string" ? body.tool_name : undefined,
  tool_input: body.tool_input,
  tool_output: body.tool_output,
  tool_response: body.tool_response,
  duration_ms: typeof body.duration_ms === "number" ? body.duration_ms : undefined,
});

// Pre/PostToolUse hooks feed the per-session tool-call history; toolHookRecord decides what
// each event means and this applies it.
async function handleToolHook(deps: HookDeps, sessionId: string, event: string, p: ToolHookPayload, cwd: string | undefined) {
  const record = toolHookRecord(event, p);
  if (record?.phase === "start") await deps.recordToolCallStart(sessionId, record.call);
  if (record?.phase === "end") await deps.recordToolCallEnd(sessionId, record.call);
  // A SUCCESSFUL write to <dir>/.mulmoterminal.json is the live-reload signal: the hook that already
  // reports every tool call tells the client to re-read that directory's config, so no fs watchers.
  // `cwd` is the request-wide resolved cwd (body.cwd over the spawn dir) — a relative file_path
  // must resolve against the same directory the header path uses, not the stale spawn cwd.
  if (publishesDirConfig(event)) {
    const target = dirConfigWriteTarget(p.tool_name, p.tool_input, cwd ?? null);
    if (target) deps.publishDirConfig(target);
    // The same hook is the editor's change feed: a file open in the Files pane may be the one
    // this call just rewrote, and the pane would otherwise not find out until it tried to save.
    const written = writtenFilePath(p.tool_name, p.tool_input, cwd ?? null);
    if (written) deps.publishFileWrite(written);
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
  // Not for a cleared session: there is no task to restore there, and the transcript this would
  // read is the conversation the user ended. The mark outlives the restart that emptied
  // `lastPrompts`, which is the only time this branch is reached after a clear (#1085).
  if (!lastPrompts.has(sessionId) && !clearedTranscripts.has(sessionId)) {
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
//
// Blanking alone does not hold: claude has just moved to a NEW transcript, so ours is frozen on the
// ended conversation, and the readers that run at the next turn end put its title and its reply
// straight back (#1085). `markTranscriptCleared` is what tells them not to.
//
// Publish LAST, and after the mark is durable: the publish itself re-reads the reply for a session
// that is `waiting`, which is the very read the mark exists to stop.
async function clearHeaderPrompt(deps: HookDeps, sessionId: string, cwd: string | undefined): Promise<void> {
  lastPrompts.set(sessionId, "");
  lastResponses.set(sessionId, "");
  await markTranscriptCleared(sessionId, cwd);
  deps.forgetTitle(sessionId);
  deps.publishActivity(sessionId);
}

// Header-prompt / AI-title side effects of a hook, per event: track the submitted prompt
// (UserPromptSubmit), drop it on `/clear` (SessionStart source=clear), or (re)generate the
// AI title once a turn's reply is on disk (Stop). Kept out of the route so its branching
// doesn't inflate the handler. Runs before handleActivityHook so the activity publish it
// triggers already carries the new lastPrompt.
async function applyHeaderHooks(deps: HookDeps, sessionId: string, event: string, body: Record<string, unknown>, cwd: string | undefined): Promise<void> {
  const effect = headerHookEffect(event, body);
  if (!effect) return;
  if (effect.kind === "prompt") {
    await trackPromptForHeader(sessionId, effect.text, cwd);
    deps.noteTitleTurn(sessionId, effect.text);
    return;
  }
  if (effect.kind === "clear") return clearHeaderPrompt(deps, sessionId, cwd);
  void deps.maybeGenerateTitle(sessionId, cwd);
}

// The scalar fields the handler reads straight off a hook body, checked once here so the flow
// below reads as flow. Every one is a string on a well-formed payload and anything at all on a
// malformed one, which is why none of them is taken on trust.
function hookFields(body: Record<string, unknown>) {
  return {
    event: typeof body.hook_event_name === "string" ? body.hook_event_name : "",
    toolName: typeof body.tool_name === "string" ? body.tool_name : undefined,
    message: typeof body.message === "string" ? body.message : "",
    // Which KIND of notification — a subagent finishing arrives here as `agent_completed`, and
    // must not be read as the agent waiting on the user (#874).
    notificationType: typeof body.notification_type === "string" ? body.notification_type : undefined,
  };
}

// Claude hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
async function handleHookRequest(deps: HookDeps, req: Request, res: Response) {
  // express hands `req.body` back as `any`, so every field below is read through a check —
  // this is a request body from outside, not a shape anything has verified.
  const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
  const sessionId = resolveHookSessionId(req.headers["x-mt-session"], body.session_id, (id) => SESSION_ID_RE.test(id));
  const { event, toolName, message, notificationType } = hookFields(body);
  if (!sessionId && body.session_id) {
    // Rejecting silently would make hooks look simply broken; the id shape is the
    // precondition for using it as a Firestore doc id and as push routing.
    console.warn(`[hook] ignoring ${event} — session id is not a canonical uuid`);
  }
  if (sessionId) {
    const entry = ptys.get(sessionId);
    const active = !!(entry && entry.active);
    const cwd = resolveHookCwd(body.cwd, entry?.cwd);
    void noteLiveCwd(sessionId, body.cwd).catch(() => undefined);
    await applyHeaderHooks(deps, sessionId, event, body, cwd);
    // Before the activity publish below, so the row it mirrors to the phone already carries this
    // hook's phase (a turn's first Edit must read as "editing" in the same push, not the next one).
    // Live sessions only: a tracked turn is reclaimed by reap, which itself does nothing without a
    // pty — so tracking an id with no pty (any well-formed uuid may be posted here) would never be
    // reclaimed. A session whose pty is gone simply reports no phase, as it does before its first tool.
    if (entry) deps.noteWorkPhase(sessionId, event, toolName);
    handleActivityHook(deps, sessionId, event, active, message, notificationType);
    await handleToolHook(deps, sessionId, event, toolPayload(body), cwd);
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
