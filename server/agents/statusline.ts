// Claude Code pipes a JSON status payload to the configured `statusLine` command on
// stdin. It is the only source for the subscription rate-limit windows: they are not on
// the Messages API (whose x-ratelimit-* headers are the API-key RPM/TPM quota, a
// different budget) and not in the transcript, so they cannot be derived from tokens.
//
// `rate_limits` is absent for API-key billing, absent until the session's first API
// response, and each window can be absent on its own — nothing here is guaranteed.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finiteNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface RateLimitWindow {
  usedPercentage: number; // 0-100, fractional
  resetsAt_sec: number | null; // Unix epoch seconds
}

export interface RateLimits {
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
}

function windowFrom(raw: unknown): RateLimitWindow | null {
  if (!isRecord(raw)) return null;
  const used = finiteNumber(raw.used_percentage);
  return used === null ? null : { usedPercentage: used, resetsAt_sec: finiteNumber(raw.resets_at) };
}

// Null when the payload carries neither window, so a caller can tell "nothing to show"
// from "0% used".
export function extractRateLimits(payload: unknown): RateLimits | null {
  if (!isRecord(payload) || !isRecord(payload.rate_limits)) return null;
  const fiveHour = windowFrom(payload.rate_limits.five_hour);
  const sevenDay = windowFrom(payload.rate_limits.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

// Whether any settings layer already defines a statusLine. Claude Code allows one per
// session, so injecting ours would silently replace the user's — we only take the slot
// when it is free. Unparseable JSON counts as configured: never clobber what we failed
// to read. Callers pass "" for a file that doesn't exist.
export function statusLineConfigured(rawSettings: readonly string[]): boolean {
  return rawSettings.some((raw) => {
    if (!raw.trim()) return false;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) && parsed.statusLine !== undefined;
    } catch {
      return true;
    }
  });
}

// The injected statusLine: POST the payload and print nothing, so the row stays empty
// and the numbers surface in the GUI instead. Mirrors the hook command's shape.
export function statusLineCommand(host: string, port: string | number, sessionId: string): string {
  return (
    `curl -s -X POST http://${host}:${port}/api/rate-limits ` + `-H 'content-type: application/json' -H 'x-mt-session: ${sessionId}' -d @- >/dev/null 2>&1`
  );
}
