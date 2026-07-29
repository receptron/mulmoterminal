// The rate-limit wire shape, and the one parser for it (#387).
//
// Here rather than on either side because BOTH decide from it: the server reads it back out of its
// own cache file, and the browser reads it off `/api/rate-limits`. Written twice it was written
// twice differently — jscpd caught the copies before they had a chance to drift.
//
// Everything is optional on purpose. A window can be absent because the agent is not installed,
// because the plan is API-key billed, because no session has answered yet, or because upstream
// dropped the field (anthropics/claude-code#40094). None of those are zero, and a gauge reading
// 0% when the truth is 83% is the worst thing this data can do.
import { isRecord } from "./isRecord.js";
import { finiteNumber } from "./finiteNumber.js";

export interface RateLimitWindow {
  usedPercentage: number; // 0-100, fractional
  resetsAt_sec: number | null; // Unix epoch seconds
}

export interface RateLimits {
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
}

export function parseRateLimitWindow(raw: unknown): RateLimitWindow | null {
  if (!isRecord(raw)) return null;
  const used = finiteNumber(raw.usedPercentage);
  return used === null ? null : { usedPercentage: used, resetsAt_sec: finiteNumber(raw.resetsAt_sec) };
}

/** Null when neither window survives, so a caller can tell "nothing to show" from "0% used". */
export function parseRateLimits(raw: unknown): RateLimits | null {
  if (!isRecord(raw)) return null;
  const fiveHour = parseRateLimitWindow(raw.fiveHour);
  const sevenDay = parseRateLimitWindow(raw.sevenDay);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}
