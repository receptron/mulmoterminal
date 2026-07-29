import { isRecord } from "../../common/isRecord.js";

export type AntigravityTurnBoundary = "user_start" | "turn_complete";

export function boundaryOutcome(
  boundary: AntigravityTurnBoundary,
  isActive: boolean,
): {
  effects: Array<{ kind: "working" | "waiting"; value: boolean }>;
  push: string | null;
} {
  if (boundary === "user_start") {
    return {
      effects: [
        { kind: "working", value: true },
        { kind: "waiting", value: false },
      ],
      push: null,
    };
  }
  return {
    effects: [
      { kind: "working", value: false },
      { kind: "waiting", value: !isActive },
    ],
    push: isActive ? null : "Turn completed",
  };
}

export function parseAntigravityTranscriptLine(line: string): AntigravityTurnBoundary | null {
  if (!line.trim()) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;

  if (doc.type === "USER_INPUT" || doc.source === "USER_EXPLICIT") {
    return "user_start";
  }

  if (doc.type === "PLANNER_RESPONSE" && doc.status === "DONE" && (!Array.isArray(doc.tool_calls) || doc.tool_calls.length === 0)) {
    return "turn_complete";
  }

  return null;
}
