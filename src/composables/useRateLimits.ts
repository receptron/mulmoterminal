import { ref } from "vue";

// The subscription's 5h / 7d rate-limit windows, served by GET /api/rate-limits from
// whatever the injected statusLine last reported. Account-wide, so this is a SINGLETON:
// every view shows the same budget.
export interface RateLimitWindow {
  usedPercentage: number;
  resetsAt_sec: number | null;
}
export interface RateLimits {
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
}

const FETCH_TIMEOUT_MS = 8000;
// The windows move as sessions work, but slowly — a 5h budget doesn't need second-level
// tracking, and polling only runs while the feature is enabled.
const REFRESH_MS = 60_000;

const limits = ref<RateLimits | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finiteNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseWindow(raw: unknown): RateLimitWindow | null {
  if (!isRecord(raw)) return null;
  const used = finiteNumber(raw.usedPercentage);
  return used === null ? null : { usedPercentage: used, resetsAt_sec: finiteNumber(raw.resetsAt_sec) };
}

function parseLimits(data: unknown): RateLimits | null {
  if (!isRecord(data)) return null;
  const fiveHour = parseWindow(data.fiveHour);
  const sevenDay = parseWindow(data.sevenDay);
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

// A failure leaves the last known windows in place: a blanked gauge reads as "0% used",
// which is the opposite of the truth we'd be failing to fetch.
async function load(): Promise<void> {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/rate-limits", { signal: controller.signal });
    if (!res.ok) throw new Error(`rate-limits request failed: ${res.status}`);
    limits.value = parseLimits(await res.json());
  } catch {
    // keep the previous value
  } finally {
    clearTimeout(abort);
  }
}

export function useRateLimits() {
  // Idempotent: the toolbar mounts once per view, and start() may be re-entered when the
  // settings toggle flips.
  function start(): void {
    void load();
    if (timer === null) timer = setInterval(() => void load(), REFRESH_MS);
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
    limits.value = null;
  }

  return { limits, start, stop, load };
}
