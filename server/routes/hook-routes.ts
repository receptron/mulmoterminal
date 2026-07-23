// The Claude hook endpoint: every Stop / Notification / Pre|PostToolUse / SessionStart
// POSTs here. One request fans out to the session's attention flags, a push to the user's
// phone, the tool-call history, the header prompt and the AI title. Split from index.ts
// (#548 step 3g) — the fan-out is what made the route long, not the route itself.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { dirConfigWriteTarget } from "../config/dir-config.js";
import { activityHookEffects, pushKindFor, resolveHookCwd, resolveHookSessionId } from "../session/activity-hook.js";
import { headerHookEffect } from "../session/header-hook.js";
import { lastPrompts, lastResponses, ptys } from "../session/registry.js";
import { latestUserPrompt } from "../session/session-reads.js";
import { notifyTaskFinished } from "../session/task-push.js";
import { preferredHeaderPrompt } from "../session/transcript.js";
import { failPendingTranslation } from "../session/translation-worker.js";
import { publishesDirConfig, toolHookRecord } from "../session/tool-hook.js";

// The header shows one line, so a longer prompt is stored truncated rather than in full.

export interface HookDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  publishActivity: (id: string) => void;
  forgetTitle: (id: string) => void;
  noteTitleTurn: (id: string, prompt: string) => void;
  /** Feed the live turn's tool names, so the published status can say planning vs editing (#727). */
  noteWorkPhase: (id: string, event: string, toolName?: string) => void;
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
  if (kind) void notifyTaskFinished(sessionId, kind, message, deps.uiPort);
}

interface HookToolPayload {
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
  duration_ms?: number;
}

// Pre/PostToolUse hooks feed the per-session tool-call history; toolHookRecord decides what
// each event means and this applies it.
async function handleToolHook(deps: HookDeps, sessionId: string, event: string, p: HookToolPayload, cwd: string | undefined) {
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
  const effect = headerHookEffect(event, body);
  if (!effect) return;
  if (effect.kind === "prompt") {
    await trackPromptForHeader(sessionId, effect.text, cwd);
    deps.noteTitleTurn(sessionId, effect.text);
    return;
  }
  if (effect.kind === "clear") return clearHeaderPrompt(deps, sessionId);
  void deps.maybeGenerateTitle(sessionId, cwd);
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
    const cwd = resolveHookCwd(body.cwd, entry?.cwd);
    await applyHeaderHooks(deps, sessionId, event, body, cwd);
    // Before the activity publish below, so the row it mirrors to the phone already carries this
    // hook's phase (a turn's first Edit must read as "editing" in the same push, not the next one).
    deps.noteWorkPhase(sessionId, event, typeof body.tool_name === "string" ? body.tool_name : undefined);
    handleActivityHook(deps, sessionId, event, active, typeof body.message === "string" ? body.message : "");
    await handleToolHook(deps, sessionId, event, body, cwd);
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
