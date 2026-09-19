// What a tool hook means, separated from the recorders and the pty table it currently
// reaches for.
//
// Three decisions live here, and each has its own way of going quietly wrong:
//   - which events OPEN a history entry and which CLOSE one
//   - which payload field carries the output, since the CLI has used two names
//   - whether this event should trigger the directory-config live reload
//
// The last one is deliberately narrower than it looks: only a SUCCESSFUL write signals a
// reload. Letting the failure event through makes every rejected write to
// .mulmoterminal.json tell every watching client to re-read a file that did not change.

// `| undefined` on each, matching ToolCallStart below: under exactOptionalPropertyTypes an absent
// key and a key holding undefined are different types, and the hook route reads these fields off
// an unverified request body, so it answers undefined rather than omitting them.
export interface ToolHookPayload {
  tool_use_id?: string | undefined;
  tool_name?: string | undefined;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
  error?: unknown;
  duration_ms?: number | undefined;
}

export interface ToolCallStart {
  toolUseId?: string | undefined;
  toolName?: string | undefined;
  toolInput: unknown;
}

export interface ToolCallEnd extends ToolCallStart {
  toolOutput: unknown;
  durationMs?: number | undefined;
  status: "completed" | "failed";
}

export type ToolHookRecord = { phase: "start"; call: ToolCallStart } | { phase: "end"; call: ToolCallEnd } | null;

// A failed tool fires PostToolUseFailure, NOT PostToolUse — both close the entry, and the
// difference between them is the whole reason the tools pane can show a failure at all.
// Collapse them and a user debugging a stuck agent reads a history in which nothing failed.
export function toolHookRecord(event: string, payload: ToolHookPayload): ToolHookRecord {
  const call = { toolUseId: payload.tool_use_id, toolName: payload.tool_name, toolInput: payload.tool_input };
  if (event === "PreToolUse") return { phase: "start", call };
  if (event !== "PostToolUse" && event !== "PostToolUseFailure") return null;
  return {
    phase: "end",
    call: {
      ...call,
      // The CLI has used both names; whichever is present is the output. Lose this and tool
      // outputs render blank for whichever version uses the other one.
      toolOutput: payload.tool_output ?? payload.tool_response ?? (event === "PostToolUseFailure" ? payload.error : undefined),
      durationMs: payload.duration_ms,
      status: event === "PostToolUseFailure" ? "failed" : "completed",
    },
  };
}

// Only a successful write is a live-reload signal.
export function publishesDirConfig(event: string): boolean {
  return event === "PostToolUse";
}
