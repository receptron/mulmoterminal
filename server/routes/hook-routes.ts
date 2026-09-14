// The agent hook endpoint: every Stop / Notification / Pre|PostToolUse / SessionStart
// POSTs here. One request fans out to the session's attention flags, a push to the user's
// phone, the tool-call history, the header prompt and the AI title. Split from index.ts
// (#548 step 3g) — the fan-out is what made the route long, not the route itself.
import type { Express, Request, Response } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { isRecord } from "../../common/isRecord.js";
import { copilotHookBody } from "../agents/copilot-hook.js";
import { cursorHookBody } from "../agents/cursor-hook.js";
import { recordCursorStop } from "../agents/cursor-usage.js";
import { ASK_QUESTION_TOOL, parseAskQuestions, type AskQuestionDone, type AskQuestionEvent } from "../../common/askQuestion.js";
import { watchOtherWrites } from "../session/write-to-session.js";
import { dirConfigWriteTarget } from "../config/dir-config.js";
import { writtenFilePath } from "../files/tool-writes.js";
import { activityHookEffects, claudeOwnSessionId, pushKindFor, resolveHookCwd, resolveHookSessionId } from "../session/activity-hook.js";
import { runCompletionHook } from "../session/completion-hooks.js";
import { messageOf } from "../errors.js";
import { headerHookEffect } from "../session/header-hook.js";
import { claudeSessionIds, lastPrompts, lastResponses, ptys } from "../session/registry.js";
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
  /** Tell an open prompts pane that this session's list just grew. Its own channel because the
   *  activity row cannot carry it — see common/promptChannel.ts. */
  publishPromptSubmitted: (sessionId: string) => void;
  /** Offer a live AskUserQuestion dialog's choices to the pane. No-op while the switch is off. */
  publishQuestion: (event: AskQuestionEvent | AskQuestionDone) => void;
  /** Which port this host's UI answers on, so a receiver can open it instead of guessing. */
  uiPort: string;
}

// Activity hooks update a session's working / needs-attention flags. `active` (this
// session is the user's actively-viewed pane) suppresses the attention flag — see
// activityHookEffects for why a mere attached socket doesn't count in the grid.
function handleActivityHook(deps: HookDeps, sessionId: string, active: boolean, fields: HookFields) {
  const { event } = fields;
  for (const eff of activityHookEffects(event, active, fields.notificationType)) {
    if (eff.kind === "working") deps.setWorking(sessionId, eff.value, event);
    else deps.setWaiting(sessionId, eff.value, event);
  }
  // Push regardless of `active` — the phone is elsewhere, unlike the attention beep.
  // A finished turn (Stop) and a blocked one (Notification) both reach here; the kind
  // decides the wording. Stop is one event per finished turn, so this fires once even
  // though a background Stop publishes twice.
  //
  // The payload is handed over whole: what a push can say about this moment is what the hook
  // reported about it, and reading either half back off disk is what put the user's own prompt
  // on their phone (#1696).
  const kind = pushKindFor(event, fields.notificationType);
  if (kind) void notifyTaskFinished(sessionId, kind, { message: fields.message, reply: fields.lastAssistantMessage }, deps.uiPort);
  // A finished turn is the ONLY success signal a PTY-hosted agent gives us (#1070). It is not
  // a process exit — `claude` sits at its prompt afterwards — so a worker that never reaches
  // Stop (blocked on a permission dialog nobody can answer, or dead before its first turn) is
  // exactly the failed refresh, and reap reports it as such. No-op unless a hook is registered,
  // which a hidden feeds worker does — and, since #1188, a hidden CLAUDE spawnBackgroundChat.
  // Claude, copilot and cursor all reach here — the latter two by translation (copilot-hook.ts,
  // cursor-hook.ts) — so this line is no longer claude-only, and the sentence that said it was is
  // gone rather than reworded. What keeps the behaviour unchanged is the registration side, not
  // this one: `runCompletionHook` is a no-op unless a hook was registered for the session, and
  // spawnBackgroundChat registers one only for claude, for the reason its own comment now gives.
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

// A live AskUserQuestion dialog, offered to the pane as buttons (#1679). It rides the hook that
// ALREADY reports every tool call, so nothing extra is registered with Claude Code — the choices
// have been arriving here all along, unread. Nothing is answered from this side: the pane types
// into the same dialog the terminal is showing, which is what lets either end answer it.
function offerQuestion(deps: HookDeps, sessionId: string, call: ToolCallStart): void {
  if (call.toolName !== ASK_QUESTION_TOOL || !call.toolUseId) return;
  const questions = parseAskQuestions(call.toolInput);
  if (!questions) return;
  // From here, count what anyone else types into this session: it is what tells an answer that the
  // dialog is no longer the one it was computed for (#1685).
  watchOtherWrites(sessionId);
  deps.publishQuestion({ sessionId, toolUseId: call.toolUseId, questions });
}

// The other half, and not optional: PostToolUse is how the pane learns the dialog CLOSED, whether
// it was answered in the terminal, answered from the pane, or cancelled with Esc. Without it the
// buttons stay live over a prompt, where the keys they send would walk the input history and
// submit whatever they landed on.
function closeQuestion(deps: HookDeps, sessionId: string, call: ToolCallStart): void {
  if (call.toolName !== ASK_QUESTION_TOOL || !call.toolUseId) return;
  deps.publishQuestion({ sessionId, toolUseId: call.toolUseId, done: true });
}

// Pre/PostToolUse hooks feed the per-session tool-call history; toolHookRecord decides what
// each event means and this applies it.
async function handleToolHook(deps: HookDeps, sessionId: string, event: string, p: ToolHookPayload, cwd: string | undefined) {
  const record = toolHookRecord(event, p);
  if (record?.phase === "start") {
    await deps.recordToolCallStart(sessionId, record.call);
    offerQuestion(deps, sessionId, record.call);
  }
  if (record?.phase === "end") {
    await deps.recordToolCallEnd(sessionId, record.call);
    closeQuestion(deps, sessionId, record.call);
  }
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

/** Remember the id claude reports for ITSELF, when the body names a usable one. It is what lets
 *  the prompts pane keep reading a session whose id claude has re-minted — see registry.ts. */
function rememberClaudeSessionId(sessionId: string, bodyValue: unknown): void {
  const claudeId = claudeOwnSessionId(bodyValue, (id) => SESSION_ID_RE.test(id));
  if (claudeId) claudeSessionIds.set(sessionId, claudeId);
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
async function clearHeaderPrompt(deps: HookDeps, sessionId: string, claudeId: string | null, cwd: string | undefined): Promise<void> {
  lastPrompts.set(sessionId, "");
  lastResponses.set(sessionId, "");
  // The mark carries claude's NEW id as well as the moment, because the prompts pane needs both to
  // find the new conversation in claude's seamless prompt history — and a restart that remembers
  // only the boundary leaves that pane empty until the next hook (#1749). This hook is where the id
  // is announced, so it is passed rather than read back from the live mapping.
  await markTranscriptCleared(sessionId, cwd, claudeId ?? undefined);
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
    // Here rather than off the activity publish below: that one is suppressed when the working
    // flag does not MOVE, so a prompt sent into a turn that is already running announces nothing —
    // and interrupting a running turn is the case the prompts pane exists for (#1748). This is the
    // one place that knows a REAL prompt arrived, injected text having been filtered out already.
    deps.publishPromptSubmitted(sessionId);
    return;
  }
  if (effect.kind === "clear")
    return clearHeaderPrompt(
      deps,
      sessionId,
      claudeOwnSessionId(body.session_id, (id) => SESSION_ID_RE.test(id)),
      cwd,
    );
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
    // What a Stop says the turn ended with. Claude Code hands the reply to the very event that
    // reports the turn, so the push no longer has to reconstruct it from the transcript (#1696).
    // Absent on a Claude Code that predates the field, which is why nothing downstream requires it.
    lastAssistantMessage: typeof body.last_assistant_message === "string" ? body.last_assistant_message : undefined,
    // Which KIND of notification — a subagent finishing arrives here as `agent_completed`, and
    // must not be read as the agent waiting on the user (#874).
    notificationType: typeof body.notification_type === "string" ? body.notification_type : undefined,
  };
}

type HookFields = ReturnType<typeof hookFields>;

/** One header value as a string. express hands back `string | string[] | undefined`, and a repeated
 *  header is not a hook we sent — reading the array's first entry would accept a forged second one
 *  alongside ours, so a repeat is simply not a value. */
const readHeader = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

// Agent hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so
// we can flag which background sessions have new activity / build tool history.
/** Which agents speak their own hook vocabulary, and what turns it into claude's. An agent absent
 *  from here is claude-shaped and its body is passed through untouched.
 *
 *  A MAP, not an object, and for the same reason `terminal-ws-path.ts` gives for its own: the key
 *  is an attacker-controlled request header, and a plain object answers `__proto__` with
 *  `Object.prototype` — truthy, then called as a function, then a 500 (Codex round 15 of #2065).
 *  A Map has no prototype chain to walk into. */
const TRANSLATE_HOOK = new Map<string, (hookName: string | undefined, payload: unknown) => Record<string, unknown> | null>([
  ["copilot", copilotHookBody],
  ["cursor", cursorHookBody],
]);

async function handleHookRequest(deps: HookDeps, req: Request, res: Response) {
  // express hands `req.body` back as `any`, so every field below is read through a check —
  // this is a request body from outside, not a shape anything has verified.
  //
  // A COPILOT or CURSOR hook arrives here too, in that agent's own vocabulary, and is translated
  // into claude's before anything reads it. One endpoint rather than three because
  // everything past this line — the flags, the push, the tool history, the header — is written
  // against claude's event names, and a second vocabulary would mean a second copy of all of it.
  // The agent says so in a header. For copilot the payload does not carry the event name at all;
  // for cursor it does, but the registering side always knows it, and reading it from the header
  // keeps the two branches identical.
  const raw: Record<string, unknown> = isRecord(req.body) ? req.body : {};
  const agent = readHeader(req.headers["x-mt-agent"]) ?? "";
  const translate = TRANSLATE_HOOK.get(agent);
  const body = translate ? translate(readHeader(req.headers["x-mt-hook"]), raw) : raw;
  // Null means a payload this server cannot act on — an event it does not translate, or one with no
  // session id. Not an error: both hook files are machine-global, so sessions this server never
  // started post here too, and theirs are exactly the ones to answer quietly.
  if (!body) {
    res.json({ ok: true });
    return;
  }
  const sessionId = resolveHookSessionId(req.headers["x-mt-session"], body.session_id, (id) => SESSION_ID_RE.test(id));
  const fields = hookFields(body);
  const { event, toolName } = fields;
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
    // AFTER the header hooks, so a `/clear` empties the chain first and the id this very hook
    // carries — claude's new one — is the first of the new conversation rather than the last of
    // the ended one. Off EVERY hook, not just a prompt: the chain lives in memory, so the sooner
    // after a restart it is re-learned the shorter the window in which a reissued id reads as
    // ours (#1749).
    rememberClaudeSessionId(sessionId, body.session_id);
    // Before the activity publish below, so the row it mirrors to the phone already carries this
    // hook's phase (a turn's first Edit must read as "editing" in the same push, not the next one).
    // Live sessions only: a tracked turn is reclaimed by reap, which itself does nothing without a
    // pty — so tracking an id with no pty (any well-formed uuid may be posted here) would never be
    // reclaimed. A session whose pty is gone simply reports no phase, as it does before its first tool.
    if (entry) deps.noteWorkPhase(sessionId, event, toolName);
    // Cursor's token counts, taken off the RAW payload rather than the translated body: they are
    // cursor's own fields and claude has no counterpart for the translation to carry them in. The
    // only agent recorded here, because it is the only one that states its usage nowhere a badge
    // poll could read it back (cursor-usage.ts).
    //
    // BEFORE the activity publish below, for noteWorkPhase's reason one line up: that push is what
    // moves the cell out of `working`, and the cell answers that transition by re-reading its
    // badges. Recorded afterwards, the read could arrive first and show the turn before this one.
    //
    // LIVE SESSIONS ONLY, for noteWorkPhase's OTHER reason, and here it is a leak rather than a
    // no-op: cursor's hook file is machine-global, so a cursor the user started in their own
    // terminal posts here too. Its id has no pty, so nothing ever reaps it — an entry recorded for
    // it would sit in the map for the life of the process, once per such session (CodeRabbit on
    // #2071). A session of ours always has an entry: its pty is what the hook is reporting about.
    if (entry && agent === "cursor" && event === "Stop") recordCursorStop(sessionId, raw);
    handleActivityHook(deps, sessionId, active, fields);
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
  // Hooks (Stop / Notification / Pre|PostToolUse / SessionStart) POST their payload here so we can
  // flag which background sessions have new activity / build tool history. Claude's arrive in that
  // vocabulary already; copilot's and cursor's are translated into it above.
  // Return the promise rather than dropping it: express 5 forwards a rejected handler
  // to its error middleware, and swallowing it here would turn a failed hook into an
  // unhandled rejection instead of a 500.
  app.post("/api/hook", (req, res) => handleHookRequest(deps, req, res));
  // A pre-flight for the machine-global hook posters (server/agents/cursor-hooks-file.ts). Their
  // command line outlives this server — a crash skips the exit handler, and a user who edits the
  // hook file makes it one we may no longer rewrite — so before sending a PROMPT and its tool
  // arguments to a bare local port, the poster asks whether the thing listening there is us. The
  // registry check it does first cannot answer that on its own: a crashed instance's entry can
  // name a pid the OS has since recycled, which is the failure #2063 hit twice from the other side
  // (Codex round 17 of #2065).
  //
  // On the hook path deliberately, rather than a new endpoint: it answers for exactly the thing the
  // poster is about to use, and a server that has this route mounted is by definition able to
  // receive the POST.
  app.get("/api/hook", (_req, res) => res.json({ mulmoterminal: true }));
}
