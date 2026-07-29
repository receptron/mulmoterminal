// The gauge's data, polled while the grid header is on screen (#387).
//
// A singleton: the windows are an account-wide budget, so every view shows the same numbers and
// polling them twice would only spend the budget twice.
//
// The poll is a POST, not a GET, and that is deliberate rather than clumsy. Asking is what permits
// the server to spend a Claude query on a probe, and `same-origin-guard.ts` gates POSTs while
// leaving safe methods open — so a GET that triggered a probe could be fired by any page the user
// happens to visit, at their expense.
import { ref } from "vue";
import { parseRateLimits } from "../../common/rateLimits";
import { isRecord } from "../../common/isRecord";
import type { ClaudeProbeState, RateLimitSnapshot } from "./rateLimitGauge";

const FETCH_TIMEOUT_MS = 8000;
// The server refuses to probe more often than its own staleness window, so a tighter poll here
// buys nothing; this only has to be often enough that a reader who leaves the tab open sees the
// number move within a few minutes of it actually moving.
const REFRESH_MS = 120_000;
// While a probe is running, though, the answer is seconds away and the gauge is visibly missing
// half of itself. Waiting out the full interval means the first thing a user ever sees is Codex
// alone — which is exactly how this read as broken the first time it was opened.
const AWAITING_PROBE_MS = 6000;

const snapshot = ref<RateLimitSnapshot | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;

const PROBE_STATES: readonly ClaudeProbeState[] = ["ok", "no-claude", "no-windows", "no-report"];
const isProbeState = (v: unknown): v is ClaudeProbeState => typeof v === "string" && (PROBE_STATES as readonly string[]).includes(v);

// A failure leaves the last known windows in place. Blanking them would read as "0% used", which
// is the opposite of the truth we just failed to fetch.
async function load(): Promise<boolean> {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/rate-limits/refresh", { method: "POST", signal: controller.signal });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    if (!isRecord(data)) return false;
    snapshot.value = {
      claude: parseRateLimits(data.claude),
      codex: parseRateLimits(data.codex),
      // Carried verbatim rather than inferred here: the server is the only place that knows
      // whether a probe was refused, timed out, or answered with no windows (#1011).
      claudeProbe: isProbeState(data.claudeProbe) ? data.claudeProbe : undefined,
    };
    return data.probing === true;
  } catch {
    // offline, aborted, or the route is not there — keep what we had
    return false;
  } finally {
    clearTimeout(abort);
  }
}

// Which chain is the live one. A counter alone cannot answer that: `load()` is in flight across
// the gap where a header unmounts and remounts, so its completion lands AFTER the new chain has
// started and — knowing only that a watcher exists — schedules a second timer. `timer` then holds
// the newer handle, stop() clears that one, and the older chain polls on forever. Every request it
// makes is one the server may answer by spending a Claude query, so a leaked chain quietly doubles
// the cost of the thing being measured.
let generation = 0;

// Chained rather than an interval, so the gap can depend on the answer: seconds while a probe is
// on its way, minutes once the gauge is whole.
function scheduleNext(delay_ms: number, chain: number): void {
  if (watchers === 0 || chain !== generation) return;
  timer = setTimeout(() => {
    void load().then((probing) => scheduleNext(probing ? AWAITING_PROBE_MS : REFRESH_MS, chain));
  }, delay_ms);
}

const runChain = (chain: number): void => {
  void load().then((probing) => scheduleNext(probing ? AWAITING_PROBE_MS : REFRESH_MS, chain));
};

/** Reference-counted so two mounted headers do not double the polling — and so the last one
 * leaving actually stops it, which is what keeps the server from probing for nobody. */
export function useRateLimits() {
  return {
    snapshot,
    start(): void {
      watchers++;
      // Only the zero-to-one transition starts a chain; a second header rides the first one's.
      if (watchers > 1) return;
      generation++;
      runChain(generation);
    },
    stop(): void {
      watchers = Math.max(0, watchers - 1);
      if (watchers > 0) return;
      // Retire the chain even when there is no timer to clear — that is precisely the window where
      // a `load()` is still in flight and would otherwise schedule one after we stopped caring.
      generation++;
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
