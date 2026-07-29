// Feeding the tools pane's call history from the BROKER, for the agents that cannot feed it
// themselves.
//
// The history has one writer everywhere else: `/api/hook`, driven by the PreToolUse /
// PostToolUse settings claude carries (session/hook-settings.ts). codex has no hook mechanism
// and neither does agy — see the note at the top of agents/codex-activity.ts, and
// docs/codex-vs-claude.md — so for those two the pane sat empty however much they did.
//
// The broker is the one place their work is visible to us: every GUI tool they call arrives at
// /api/mcp/:sessionId with the session id in the URL. That is a PARTIAL history — their Bash,
// their edits and their other MCP servers never touch us — but a partial one is what we have,
// and the pane says so rather than implying the agent ran nothing else.
//
// Claude is deliberately EXCLUDED: its hooks match `""`, so they already report `mcp__*` calls
// too. Recording here as well would list every GUI call twice, and not even as duplicates the
// store could collapse — the broker mints its own uuid while the hook carries claude's
// `tool_use_id`, so `recordToolCallStart`'s dedupe would never see them as the same call.
import type { SessionAgent } from "../../common/sessionAgent.js";
import type { ToolCallEnd, ToolCallStart } from "../session/tool-hook.js";
import { messageOf } from "../errors.js";

/** What the broker reports about one GUI tool call. Mirrors ToolCallStart/End in session/tool-hook.ts. */
export interface GuiCallRecorder {
  start(call: { toolUseId: string; toolName: string; toolInput: unknown }): void;
  end(call: { toolUseId: string; toolName: string; toolInput: unknown; toolOutput: unknown; durationMs: number; status: "completed" | "failed" }): void;
}

/**
 * Should the broker record this session's GUI tool calls itself?
 *
 * The question is NOT "is this codex or agy" — that was the first version of this gate and it was
 * wrong. A codex LAUNCHER CHIP runs `zsh -lc exec codex …` (ws-routes.ts hands it the same GUI MCP
 * URLs), so its PtyEntry is honestly labelled `"shell"`, and matching on the agent name left that
 * cell — a real codex session, calling our tools — with an empty pane while the agent-toggle one
 * worked. No agent name identifies a session started by a command the user wrote.
 *
 * The real question is whether something ELSE is already recording these calls, and exactly one
 * thing does: claude's `--settings` hooks. So the gate is an exclusion, on two independent
 * signals, because a double entry is worse than a missing one:
 *
 *   reportsOwnCalls — this process spawned it with our hooks (registry.hookedSessions). Exact.
 *   agent           — a backstop for a claude session that outlived a restart and was never
 *                     reattached here, so nothing added it to that set, yet its pane command
 *                     still says what it is.
 *
 * Everything else records: codex and agy however they were started, and an unknown session, which
 * cannot be a hooked claude once both signals have said otherwise.
 */
export function brokerRecordsGuiCalls({ agent, reportsOwnCalls }: { agent: SessionAgent | null; reportsOwnCalls: boolean }): boolean {
  return !reportsOwnCalls && agent !== "claude";
}

/** The same two writers `/api/hook` uses, so both feeds land in one store in one shape. */
export interface ToolCallSink {
  recordToolCallStart: (sessionId: string, call: ToolCallStart) => Promise<void>;
  recordToolCallEnd: (sessionId: string, call: ToolCallEnd) => Promise<void>;
}

/**
 * A recorder for one session, or null when that session's agent reports its own calls.
 *
 * The recorder is SYNCHRONOUS and fire-and-forget: it sits on the tool-call path, and an agent
 * waiting on `presentDocument` must not also wait on our history write. A failed write costs one
 * row in a pane, so it is logged and dropped rather than turned into a tool error.
 */
export function guiCallRecorderFor(
  sessionId: string,
  session: { agent: SessionAgent | null; reportsOwnCalls: boolean },
  sink: ToolCallSink,
): GuiCallRecorder | null {
  if (!brokerRecordsGuiCalls(session)) return null;
  const swallow = (p: Promise<void>) => void p.catch((err: unknown) => console.error(`[gui-history] ${sessionId}: ${messageOf(err)}`));
  return {
    start: (call) => swallow(sink.recordToolCallStart(sessionId, call)),
    end: (call) => swallow(sink.recordToolCallEnd(sessionId, call)),
  };
}
