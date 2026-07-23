// The decision behind POST /api/agent/toolResult, split from its I/O so it can be tested
// without booting the server (#676). The route keeps the store write and the publish; this
// only validates the body and decides what to store and whether to publish.
import { SESSION_ID_RE } from "../config/env.js";
import { isRecord } from "../session/transcript.js";
import type { ToolResult } from "../session/types.js";

export type ToolResultPlan = { ok: false; error: string } | { ok: true; stored: ToolResult; publish: boolean; sessionId: string; toolName: string };

export function planToolResultUpdate(body: unknown): ToolResultPlan {
  const source: Record<string, unknown> = isRecord(body) ? body : {};

  const sessionId = source.sessionId;
  // The id flows into a pub/sub channel name and a filename — keep it to the UUID shape.
  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return { ok: false, error: "invalid sessionId" };
  }
  const toolName = source.toolName;
  if (typeof toolName !== "string" || !toolName) {
    return { ok: false, error: "invalid toolName" };
  }
  const uuid = source.uuid;
  if (typeof uuid !== "string" || !uuid) {
    return { ok: false, error: "invalid uuid" };
  }

  // Store everything except the routing fields; the rest is the payload the panel renders.
  const stored: ToolResult = { ...source, uuid };
  delete stored.sessionId;

  // `persistOnly === true` means the GUI panel is persisting a view's own state change:
  // store it, but do NOT re-publish. Re-publishing echoes the update back to the originating
  // panel as a fresh result, which re-seeds the view and re-emits — an infinite flicker loop.
  // The broker (new tool calls) omits the flag, so its results still publish and render live.
  const publish = stored.persistOnly !== true;
  delete stored.persistOnly;

  return { ok: true, stored, publish, sessionId, toolName };
}
