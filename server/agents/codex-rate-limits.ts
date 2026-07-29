// Codex reports the same two windows as Claude, and gives them away for free: they are written
// into its own rollout file (`~/.codex/sessions/**/*.jsonl`), so reading them costs nothing —
// no injected statusLine, no probe session, no query against the budget being measured.
//
// The shape is Codex's own, and only `window_minutes` says which window is which. The names
// `primary` / `secondary` do NOT mean 5h / 7d: they are whatever the plan defines, so matching on
// the position rather than the duration would silently mislabel a plan with different windows.
//
//   "rate_limits": {
//     "primary":   {"used_percent": 2.0, "window_minutes": 300,   "resets_at": 1783818175},
//     "secondary": {"used_percent": 1.0, "window_minutes": 10080, "resets_at": 1784358265}
//   }
import type { RateLimits, RateLimitWindow } from "./statusline.js";
import { isRecord } from "../../common/isRecord.js";
import { finiteNumber } from "../../common/finiteNumber.js";

const FIVE_HOUR_MINUTES = 300;
const SEVEN_DAY_MINUTES = 7 * 24 * 60;
// A plan's window need not be exactly 300 / 10080, and a near-miss classified as "neither" would
// drop a window the user can see in Codex itself. Nearest match wins, within this much.
const WINDOW_TOLERANCE_MINUTES = 60;

interface CodexWindow {
  window: RateLimitWindow;
  minutes: number;
}

function windowFrom(raw: unknown): CodexWindow | null {
  if (!isRecord(raw)) return null;
  const used = finiteNumber(raw.used_percent);
  const minutes = finiteNumber(raw.window_minutes);
  if (used === null || minutes === null) return null;
  return { window: { usedPercentage: used, resetsAt_sec: finiteNumber(raw.resets_at) }, minutes };
}

const closestTo = (target: number, candidates: readonly CodexWindow[]): RateLimitWindow | null => {
  const near = candidates.filter((c) => Math.abs(c.minutes - target) <= WINDOW_TOLERANCE_MINUTES);
  if (near.length === 0) return null;
  return near.reduce((best, c) => (Math.abs(c.minutes - target) < Math.abs(best.minutes - target) ? c : best)).window;
};

/**
 * The two windows out of one Codex `rate_limits` object, or null when neither is usable — same
 * contract as the Claude extractor, so the store and the UI never learn which agent they came
 * from.
 */
export function extractCodexRateLimits(rateLimits: unknown): RateLimits | null {
  if (!isRecord(rateLimits)) return null;
  const windows = [rateLimits.primary, rateLimits.secondary].flatMap((raw) => {
    const parsed = windowFrom(raw);
    return parsed ? [parsed] : [];
  });
  const fiveHour = closestTo(FIVE_HOUR_MINUTES, windows);
  const sevenDay = closestTo(SEVEN_DAY_MINUTES, windows);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

/**
 * The newest `rate_limits` in a rollout file's lines, reading from the END: the last one written
 * is the current state, and a session that ran for hours holds many. Lines that are not JSON are
 * skipped rather than failing the file — a rollout being appended to while we read it can leave a
 * partial last line.
 */
export function latestRateLimitsInRollout(lines: readonly string[]): RateLimits | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.includes("rate_limits")) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const found = findRateLimits(parsed);
      if (found) return found;
    } catch {
      // not a complete JSON line; keep looking further back
    }
  }
  return null;
}

// What the search may descend into — a different question from `isRecord`, which answers "may I
// read named fields off this". An array must fail that one and pass this one.
function childrenOf(node: unknown): unknown[] {
  if (isRecord(node)) return Object.values(node);
  return Array.isArray(node) ? node : [];
}

// `rate_limits` sits inside a record whose surrounding shape is Codex's business and has changed
// before. Searching for the key rather than a fixed path means a re-nesting upstream costs nothing.
//
// Arrays are descended into as well as records (see childrenOf): a `content: []` on the path is one
// of the shapes this search exists to survive, and stopping there would blank the gauge with nothing
// on screen to explain it.
function findRateLimits(node: unknown, depth = 0): RateLimits | null {
  const MAX_DEPTH = 6;
  if (depth > MAX_DEPTH) return null;
  if (isRecord(node) && isRecord(node.rate_limits)) {
    const extracted = extractCodexRateLimits(node.rate_limits);
    if (extracted) return extracted;
  }
  for (const value of childrenOf(node)) {
    const found = findRateLimits(value, depth + 1);
    if (found) return found;
  }
  return null;
}
