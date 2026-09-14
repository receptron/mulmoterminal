// Translating a Cursor CLI hook payload into the body the Claude hook route already understands, so
// everything downstream of /api/hook — the working/waiting dots, the attention sound, Web Push, the
// tool-call history, the work phase, the header prompt — is reached without a second copy of any of
// it. The same arrangement copilot has, and for the same reason: the effect tables downstream key
// on CLAUDE's event names (server/session/activity-hook.ts, tool-hook.ts), so a third vocabulary
// would mean a third copy of the rules for what a turn boundary does.
//
// Everything here is pure. The route's own fan-out does the work; this only renames.
//
// THE EVENT NAME COMES FROM THE HEADER, not the body — even though cursor DOES put
// `hook_event_name` in every payload. The registering side always knows the name it registered
// under, and reading it from there keeps this route's branch identical to copilot's.
//
// THE SESSION ID COMES FROM THE BODY. cursor-args.ts makes cursor's own chat id ours
// (`--resume <uuid>` with a uuid we invented; `create-chat` exists and is deliberately not used,
// see cursor-args.ts), so the `conversation_id` every payload carries is the key this
// server already has.
import { isRecord } from "../../common/isRecord.js";

/** Cursor's event names, mapped to the Claude names every downstream table is written against.
 *
 *  WHAT IS DELIBERATELY ABSENT, and why each one:
 *
 *  `beforeShellExecution` — the shape that looks like "the user is being asked something" and is
 *  not. Measured against 2026.09.10-fd3934a while the agent sat on `Waiting for approval...`: it
 *  had already fired, and it fires on EVERY shell call, approved or not. Mapping it to
 *  `Notification` would flag every tool call as needing the user. This is copilot's
 *  `permissionRequest` trap reached by another route, and cursor exposes no event that does
 *  distinguish the blocked case — so this agent drives the working and waiting halves and not the
 *  attention one.
 *
 *  `afterAgentResponse` — real, and it fires, but `stop` already marks the turn's end and the two
 *  would both resolve to `Stop`, moving the cell to waiting twice per turn.
 *
 *  `afterAgentThought`, `beforeReadFile`, `afterFileEdit` — each fires, none has a Claude
 *  counterpart whose effect table we would be reaching. Registering an event this map does not
 *  translate would post bodies nothing reads, and cursor's file is expensive to get wrong (see
 *  cursor-hooks-file.ts on what one bad entry costs). */
const EVENT_NAMES: Readonly<Record<string, string>> = {
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  stop: "Stop",
};

/** The cursor events the hook file registers. Derived from the map so the file and the translation
 *  cannot drift — and, for cursor specifically, so that no name can be registered that the CLI does
 *  not know: an unrecognised name voids the WHOLE file, silently (cursor-hooks-file.ts). */
export const CURSOR_HOOK_EVENTS: readonly string[] = Object.keys(EVENT_NAMES);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Cursor reports the working directory two ways and neither is on every event: `cwd` on the tool
 *  events, `workspace_roots` (an array, first entry the session's root) on all of them. Measured on
 *  2026.09.10-fd3934a — `stop` and `beforeSubmitPrompt` carry no `cwd` at all. */
function cwdOf(payload: Record<string, unknown>): string | undefined {
  const direct = str(payload.cwd);
  if (direct) return direct;
  const roots = payload.workspace_roots;
  return Array.isArray(roots) ? str(roots[0]) : undefined;
}

/**
 * The Claude-shaped body, or null when this is not a payload we can act on.
 *
 * Null rather than a partial body for two distinct reasons, and both are real: an event name we do
 * not translate (a cursor release adding one) has no effect table to reach, and a payload with no
 * `conversation_id` cannot be attributed to a session at all. Either is silence, not an error — the
 * hook file is machine-global, so this endpoint also hears from cursor sessions this server never
 * started, and shouting about those would be shouting about the user's own terminal.
 */
export function cursorHookBody(hookName: string | undefined, payload: unknown): Record<string, unknown> | null {
  const event = hookName ? EVENT_NAMES[hookName] : undefined;
  if (!event || !isRecord(payload)) return null;
  const sessionId = str(payload.conversation_id);
  if (!sessionId) return null;
  return {
    hook_event_name: event,
    session_id: sessionId,
    cwd: cwdOf(payload),
    // What the header line is read from. cursor spells it the same way claude does.
    prompt: str(payload.prompt),
    // The tool half. cursor's `tool_output` is the `tool_response` spelling tool-hook.ts accepts;
    // `tool_name` and `tool_input` it already shares with claude.
    tool_name: str(payload.tool_name),
    tool_input: payload.tool_input,
    tool_response: payload.tool_output,
  };
}
