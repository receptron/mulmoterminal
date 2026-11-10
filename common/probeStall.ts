// Why a rate-limit probe went silent, as far as its own terminal proved (server/agents/probe/
// probe-stall.ts reads it off the screen). The server sends it and the browser parses it back, so
// the union lives here: a value added on one side only was discarded by the other (#3291).
export const PROBE_STALLS = ["trust-prompt", "usage-limit", "subscription-disabled", "unknown"] as const;

export type ProbeStall = (typeof PROBE_STALLS)[number];

export const isProbeStall = (value: unknown): value is ProbeStall => typeof value === "string" && PROBE_STALLS.some((stall) => stall === value);
