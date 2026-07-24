// Reading turn boundaries out of a codex rollout as it is appended to. codex has no
// hook mechanism — claude reports its own turns via `--settings` hooks, and there is no
// equivalent flag to pass codex (see docs/codex-vs-claude.md) — so the rollout is the
// only place a codex turn announces that it started or finished.
//
// Everything here is pure: the tailing itself lives in session/codex-activity-watch.ts.

import { isRecord } from "../session/transcript.js";
import { activityHookEffects, pushKindFor, type ActivityEffect, type PushKind } from "../session/activity-hook.js";

export type CodexTurnBoundary = "started" | "completed";

// codex boundaries are routed through the SAME effect table as claude's hooks, so what a
// turn boundary does to the working / attention flags is defined once rather than per
// agent. codex never reports being blocked on input — its approval prompt is drawn in the
// TUI and never reaches the rollout — so there is deliberately no Notification here.
export const HOOK_EVENT_FOR: Record<CodexTurnBoundary, string> = {
  started: "UserPromptSubmit",
  completed: "Stop",
};

// Where to read next, or null when there is nothing new. A file SMALLER than the offset
// restarted underneath us (truncated, or the id was reused): reading from the stale
// offset would slice mid-record, so the read starts over from the beginning.
export function nextReadRange(offset: number, size: number): { from: number; to: number } | null {
  if (size < offset) return { from: 0, to: size };
  return size > offset ? { from: offset, to: size } : null;
}

// A poll can land mid-record, so the trailing fragment is carried to the next tick rather
// than parsed as a line. Text ending in a newline leaves nothing pending.
export function takeCompleteLines(pending: string, chunk: string): { lines: string[]; pending: string } {
  const parts = (pending + chunk).split("\n");
  return { lines: parts.slice(0, -1).filter((line) => line.trim()), pending: parts[parts.length - 1] };
}

// The `event_msg` payload type of a line, or null for anything else. A `turn_context` row
// carries a turn_id but no payload.type, so matching on the payload alone would misread it.
function eventType(line: string): string | null {
  try {
    const doc: unknown = JSON.parse(line);
    if (!isRecord(doc) || doc.type !== "event_msg" || !isRecord(doc.payload)) return null;
    return typeof doc.payload.type === "string" ? doc.payload.type : null;
  } catch {
    return null; // a row that isn't JSON — codex writes none, but a torn file could
  }
}

// The event_msg payload types that END a turn. `task_complete` is the normal finish;
// `turn_aborted` is what an INTERRUPTED turn writes (Esc / steer) — verified against real
// rollouts, where an aborted turn logs task_started … turn_aborted with NO task_complete.
// An "error" turn still gets task_complete, so only interrupts rely on turn_aborted. Miss
// it and the working flag set at task_started never clears: the spinner spins forever, no
// "finished" push fires, and reapDecisionFor keeps the detached session alive.
const TURN_END_TYPES = new Set(["task_complete", "turn_aborted"]);

// The turn boundaries in these lines, oldest first. A turn that both starts and finishes
// within one poll yields both, in order, so no transition is collapsed away.
export function turnBoundaries(lines: string[]): CodexTurnBoundary[] {
  return lines.flatMap((line) => {
    const type = eventType(line);
    if (type === "task_started") return ["started" as const];
    return type !== null && TURN_END_TYPES.has(type) ? ["completed" as const] : [];
  });
}

// What a boundary does: the flag changes, and whether the phone should hear about it.
// Both come from claude's tables so the two agents cannot drift apart — a codex turn that
// finishes has to notify exactly as a claude Stop does, or half the grid stays silent.
export interface BoundaryOutcome {
  effects: ActivityEffect[];
  push: PushKind | null;
}

export function boundaryOutcome(boundary: CodexTurnBoundary, active: boolean): BoundaryOutcome {
  const event = HOOK_EVENT_FOR[boundary];
  return { effects: activityHookEffects(event, active), push: pushKindFor(event) };
}
