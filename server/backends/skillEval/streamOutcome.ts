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
}

function parsed(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** The skills an assistant message asked the `Skill` tool for. */
function invokedSkills(record: Record<string, unknown>): string[] {
  if (record.type !== "assistant" || !isRecord(record.message) || !Array.isArray(record.message.content)) return [];
  return record.message.content.flatMap((block: unknown) =>
    isRecord(block) && block.type === "tool_use" && block.name === "Skill" && isRecord(block.input) && typeof block.input.skill === "string"
      ? [block.input.skill]
      : [],
  );
}

const deniedTools = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((d: unknown) => (isRecord(d) && typeof d.tool_name === "string" ? [d.tool_name] : [])) : [];

function resultError(result: Record<string, unknown>): string | null {
  if (result.is_error === true) return typeof result.result === "string" && result.result !== "" ? result.result : "the run ended in an error";
  return result.subtype === "success" ? null : `the run ended with ${String(result.subtype)}`;
}

export function streamOutcome(lines: readonly string[], skillSlug: string): StreamOutcome {
  const records = lines.map(parsed).filter((record): record is Record<string, unknown> => record !== null);
  const skillInvoked = records.some((record) => invokedSkills(record).includes(skillSlug));
  const result = records.findLast((record) => record.type === "result");
  if (result === undefined) return { skillInvoked, finalText: "", costUsd: 0, denied: [], error: "the run gave no result" };
  return {
    skillInvoked,
    finalText: typeof result.result === "string" ? result.result : "",
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : 0,
    denied: deniedTools(result.permission_denials),
    error: resultError(result),
  };
}
