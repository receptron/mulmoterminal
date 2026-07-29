/** The guard both sides use before reading a NUMBER off parsed JSON. Null — never 0 — for
 *  anything that is not a real number, because the callers are gauges and costs where a missing
 *  value and a zero mean opposite things (see common/rateLimits.ts).
 *
 *  `Number.isFinite` rather than a bare typeof: `JSON.parse` cannot produce NaN or Infinity, but
 *  these values also arrive from arithmetic on parsed fields, and NaN reaching a gauge renders as
 *  an empty bar rather than as an error. Sibling of common/isRecord.ts, which exists because the
 *  same one-liner had been hand-copied into 29 files. */
export const finiteNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
