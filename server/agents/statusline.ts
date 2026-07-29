// Claude Code pipes a JSON status payload to the configured `statusLine` command on stdin. It is
// the only source for the subscription's rate-limit windows: they are not on the Messages API
// (whose x-ratelimit-* headers are the API-key RPM/TPM quota, a different budget) and not in the
// transcript — a transcript records `"error":"rate_limit"` once you are already blocked, which is
// the wrong side of the question.
//
// Measured rather than assumed, because each of these decided the design (#387):
//   - `claude -p` does NOT invoke the statusLine. Only an interactive PTY session does, so the
//     probe that harvests this cannot be a headless one-shot.
//   - `rate_limits` is absent until the session's FIRST API response. An idle probe reports
//     nothing, so the probe has to be asked something before it is worth reading.
//   - It is absent for API-key billing, and each window can be absent on its own.
//
// Upstream dropped the field entirely once (anthropics/claude-code#40094, #45133 — both closed
// unfixed) before it came back. So nothing here may treat a missing field as a zero: absent means
// "show nothing", and a gauge reading 0% when the truth is 83% is the worst thing this could do.

import type { RateLimits, RateLimitWindow } from "../../common/rateLimits.js";
import { isRecord } from "../../common/isRecord.js";
import { finiteNumber } from "../../common/finiteNumber.js";

export type { RateLimits, RateLimitWindow };

function windowFrom(raw: unknown): RateLimitWindow | null {
  if (!isRecord(raw)) return null;
  const used = finiteNumber(raw.used_percentage);
  return used === null ? null : { usedPercentage: used, resetsAt_sec: finiteNumber(raw.resets_at) };
}

// Null when the payload carries neither window, so a caller can tell "nothing to show" from
// "0% used".
export function extractRateLimits(payload: unknown): RateLimits | null {
  if (!isRecord(payload) || !isRecord(payload.rate_limits)) return null;
  const fiveHour = windowFrom(payload.rate_limits.five_hour);
  const sevenDay = windowFrom(payload.rate_limits.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

// The statusLine handed to the probe: POST the payload, print nothing. Printing nothing is not a
// courtesy — Claude Code renders a row for the statusLine whether or not it writes anything, and
// #388 measured that row. The probe's terminal is never shown to anyone, which is the whole reason
// the probe exists instead of injecting this into the user's own cells.
//
// No `x-mt-session` here, unlike the hook command next door. That one is read and acted on
// (hook-routes.ts); this route has no notion of which session a reading came from and never had —
// so sending an id was a claim of identity nobody checked, which is worse than not making it.
export function statusLineCommand(host: string, port: string | number): string {
  return `curl -s -X POST http://${host}:${port}/api/rate-limits ` + `-H 'content-type: application/json' -d @- >/dev/null 2>&1`;
}
