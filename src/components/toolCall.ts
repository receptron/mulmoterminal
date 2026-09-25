// One tool call as a session's history and its live channel carry it (`toolcalls:<id>`). Shared by the
// tools pane and the blueprint view, so both read the channel through the same reader.
import { isRecord } from "../../common/isRecord";

export interface ToolCall {
  toolUseId?: string;
  toolName: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  status: "running" | "completed" | "failed";
  at: number;
  durationMs?: number;
}

// One call off the live channel. `toolName`, `status` and `at` are what every row renders from;
// without them there is no row to draw.
const CALL_STATUSES: readonly ToolCall["status"][] = ["running", "completed", "failed"];
export function readToolCall(raw: unknown): ToolCall | null {
  if (!isRecord(raw) || typeof raw.toolName !== "string" || typeof raw.at !== "number") return null;
  const status = CALL_STATUSES.find((known) => known === raw.status);
  if (!status) return null;
  return {
    toolName: raw.toolName,
    status,
    at: raw.at,
    ...(typeof raw.toolUseId === "string" ? { toolUseId: raw.toolUseId } : {}),
    ...(raw.toolInput !== undefined ? { toolInput: raw.toolInput } : {}),
    ...(raw.toolOutput !== undefined ? { toolOutput: raw.toolOutput } : {}),
    ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
  };
}
