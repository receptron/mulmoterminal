// What one `claude -p --output-format stream-json --verbose` run did, read from its lines (#3438):
// whether it invoked the skill under test, what it said last, what it cost, and what it was refused.
// Pure; a line that is not JSON, or not one of these shapes, is passed over.
import { isRecord } from "../../../common/isRecord.js";

export interface StreamOutcome {
  skillInvoked: boolean;
  finalText: string;
  costUsd: number;
  denied: string[];
  /** Set when the run ended without a successful result: an error, the budget, or no result line at all. */
  error: string | null;
  /** Set when the run never reached the model — an expired login, a rate limit: it says nothing about the task. */
  apiError: string | null;
}

function parsed(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const contentOf = (record: Record<string, unknown>, type: string): unknown[] =>
  record.type === type && isRecord(record.message) && Array.isArray(record.message.content) ? record.message.content : [];

/** The ids of the `Skill` tool calls that asked for `skillSlug`. */
function skillCallIds(record: Record<string, unknown>, skillSlug: string): string[] {
  return contentOf(record, "assistant").flatMap((block) =>
    isRecord(block) &&
    block.type === "tool_use" &&
    block.name === "Skill" &&
    isRecord(block.input) &&
    block.input.skill === skillSlug &&
    typeof block.id === "string"
      ? [block.id]
      : [],
  );
}

/** The ids of the tool calls that came back without an error. A refused call comes back as one. */
function succeededIds(record: Record<string, unknown>): string[] {
  return contentOf(record, "user").flatMap((block) =>
    isRecord(block) && block.type === "tool_result" && block.is_error !== true && typeof block.tool_use_id === "string" ? [block.tool_use_id] : [],
  );
}

const deniedTools = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((d: unknown) => (isRecord(d) && typeof d.tool_name === "string" ? [d.tool_name] : [])) : [];

function resultError(result: Record<string, unknown>): string | null {
  if (result.is_error === true) return typeof result.result === "string" && result.result !== "" ? result.result : "the run ended in an error";
  return result.subtype === "success" ? null : `the run ended with ${String(result.subtype)}`;
}

/** A result line's message when claude could not reach the model, else null. */
export function apiErrorOf(result: Record<string, unknown>): string | null {
  if (result.terminal_reason !== "api_error") return null;
  return typeof result.result === "string" && result.result !== "" ? result.result : "claude could not reach the model";
}

export function streamOutcome(lines: readonly string[], skillSlug: string): StreamOutcome {
  const records = lines.map(parsed).filter((record): record is Record<string, unknown> => record !== null);
  // Asking for the skill is not reading it: the call counts once its result came back without an error.
  const succeeded = new Set(records.flatMap(succeededIds));
  const skillInvoked = records.flatMap((record) => skillCallIds(record, skillSlug)).some((id) => succeeded.has(id));
  const result = records.findLast((record) => record.type === "result");
  if (result === undefined) return { skillInvoked, finalText: "", costUsd: 0, denied: [], error: "the run gave no result", apiError: null };
  return {
    skillInvoked,
    finalText: typeof result.result === "string" ? result.result : "",
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : 0,
    denied: deniedTools(result.permission_denials),
    error: resultError(result),
    apiError: apiErrorOf(result),
  };
}
