// The last known windows per agent, and the one rule that decides when to spend a query refreshing
// them (#387).
//
// The gauge measures a budget and the Claude probe SPENDS that budget to measure it, so the rule
// has to be demand-driven rather than a timer: a probe runs only when a browser has asked for the
// numbers recently AND what we hold is old. Nobody with the app open means no queries overnight,
// and a user who never opens the grid never pays anything.
//
// Codex is not in that bargain — its windows are read from a rollout file — so it is refreshed
// whenever asked and never gates on staleness.
import type { ClaudeStatus, RateLimits } from "../statusline.js";
import type { ProbeStall } from "../../../common/probeStall.js";

export type RateLimitAgent = "claude" | "codex";

export interface AgentRateLimits {
  limits: RateLimits;
  reportedAt_ms: number;
}

export type RateLimitSnapshot = Partial<Record<RateLimitAgent, AgentRateLimits>>;

// How old a reading may be before asking is worth another query, unless the config sets its own
// (`usageProbeIntervalMinutes`, #3153). The 5h window moves over hours, so a minute of lag costs the
// reader nothing while a tighter loop would spend real budget.
export const RATE_LIMIT_STALE_MS = 10 * 60_000;
// How recently a browser must have asked for a probe to run at all. Not the interval above: this
// one is about someone looking, and stays put whatever the reading's age is allowed to reach.
export const ASKED_RECENTLY_MS = 10 * 60_000;

// How old a reading may be and still be DRAWN. A different question from the one above — that one
// decides when to spend a query, this one decides whether the number is still a fact — and the gap
// between them is where #1293 lived: while probing was broken the header went on showing the last
// reading, and a 7d window is only dropped when its own reset passes, so a figure could be days old
// and read as current. Usage only grows within a window, so an old percentage is not merely
// imprecise, it understates, at exactly the moment the reader is checking whether they are near the
// limit.
//
// An hour because the failure backoff caps there (PROBE_RETRY_MAX_MS): a reading older than that
// means at least one whole retry cycle produced nothing, which is precisely when the gauge should
// stop vouching for it and say so instead.
export const CLAUDE_READING_MAX_AGE_MS = 60 * 60_000;

// Why a probe stopped, when it did not bring windows back. Kept apart from "how old is the
// reading" because they answer different questions: staleness decides whether a fresh probe is
// worth running, and this decides whether running one could work at all (#1011).
export type ProbeState =
  // Nothing has gone wrong that we know of.
  | { kind: "ok" }
  // `claude` cannot be found. Spawning is pointless until that changes, and re-checking costs
  // nothing (it is a PATH lookup, not a session).
  | { kind: "no-claude" }
  // A status line arrived AFTER an API response and carried no windows. That is the API-key
  // billing case, which statusline.ts documents as structural: this account will not report
  // windows however many times we ask. Retried, but slowly, because billing can change under a
  // running server.
  //
  // "after an API response" is load-bearing rather than detail. Every probe's FIRST status line
  // carries no windows — they do not exist yet — so concluding this from the absence alone made a
  // probe that then failed to finish indistinguishable from API-key billing: the wrong reason on
  // screen, an hour between retries, and no failure counted against the one that actually broke
  // (#1161).
  | { kind: "no-windows" }
  // Asked, and nothing came back before the timeout: a trust prompt nobody answered, an expired
  // login, a machine too slow to boot the TUI in 90s. Retried with a widening gap.
  //
  // `stall` is what the probe's own terminal proved about which of those it was (probe-stall.ts).
  // Only the trust prompt can be named, and naming it matters more than it looks: the probe used to
  // answer that dialog by accident, so it never surfaced — now it waits, correctly, and a user with
  // an untrusted workspace needs to be told rather than left with a permanent `n/a` (#1293).
  | { kind: "no-report"; failures: number; stall: ProbeStall };

// The gap after a failed probe, doubling each time so a broken environment costs a query an hour
// rather than one every 90 seconds. #1011: the bug was that there was no gap at all — a probe that
// timed out left the staleness test true, so the next poll started another one immediately.
export const PROBE_RETRY_BASE_MS = 90_000;
export const PROBE_RETRY_MAX_MS = 60 * 60_000;

export function probeRetryDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(PROBE_RETRY_BASE_MS * 2 ** (failures - 1), PROBE_RETRY_MAX_MS);
}

/** How long to wait before asking again, given what happened last time. */
export function retryDelayFor(state: ProbeState): number {
  if (state.kind === "no-report") return probeRetryDelay(state.failures);
  // An account with no windows is not failing — it is answering. Ask again occasionally in case
  // the billing changed, but never at the failure cadence.
  if (state.kind === "no-windows") return PROBE_RETRY_MAX_MS;
  return 0;
}

/**
 * Whether a Claude probe is worth spawning now. Both halves matter and neither is optional:
 * `askedAt` proves someone is looking, `reportedAt` proves what we have is old. A probe that runs
 * on a timer alone burns the user's window while they sleep.
 */
export interface ProbeGate {
  reportedAt_ms: number | null;
  lastAskedAt_ms: number | null;
  probeInFlight: boolean;
  /** When the last probe was STARTED — success or not. Without this a failed probe left no trace
   *  and the staleness test alone re-fired it forever (#1011). */
  lastProbeAt_ms: number | null;
  state: ProbeState;
  /** How old the reading may be before a probe is spent on it. */
  staleAfter_ms: number;
}

export function shouldProbe(now_ms: number, gate: ProbeGate): boolean {
  if (gate.probeInFlight) return false;
  // Nothing to gain from spawning: the binary is not there. Cleared the moment one appears,
  // because the check that sets this runs before every probe and costs a PATH lookup.
  if (gate.state.kind === "no-claude") return false;
  if (gate.lastAskedAt_ms === null || now_ms - gate.lastAskedAt_ms > ASKED_RECENTLY_MS) return false;
  const delay = retryDelayFor(gate.state);
  if (delay > 0 && gate.lastProbeAt_ms !== null && now_ms - gate.lastProbeAt_ms < delay) return false;
  return gate.reportedAt_ms === null || now_ms - gate.reportedAt_ms > gate.staleAfter_ms;
}

/** What one Claude status line proves about the probe, or null when it proves nothing.
 *
 *  Windows in hand is success outright. Windows ABSENT is an answer only once the session has had
 *  an API response — before that they are simply not written yet (statusline.ts), so that payload
 *  is evidence in neither direction and must leave the verdict where it was. Reading it as an
 *  answer made a probe that then died indistinguishable from API-key billing (#1161). */
export function claudeStatusVerdict(status: ClaudeStatus): ProbeState | null {
  if (status.limits) return { kind: "ok" };
  return status.afterApiResponse ? { kind: "no-windows" } : null;
}

// Whether a status line arrived during the attempt that just ended. One stamped before the probe
// started belongs to an earlier attempt; no recorded start at all with a status line already in
// hand means something answered without us asking, which counts as answered rather than a failure
// invented out of nothing.
const answeredDuringAttempt = (lastStatusLineAt_ms: number | null, lastProbeAt_ms: number | null): boolean =>
  lastStatusLineAt_ms !== null && (lastProbeAt_ms === null || lastStatusLineAt_ms >= lastProbeAt_ms);

/** One more consecutive silence. */
const afterSilence = (state: ProbeState, stall: ProbeStall): ProbeState => ({
  kind: "no-report",
  failures: state.kind === "no-report" ? state.failures + 1 : 1,
  stall,
});

// Only `no-claude` is the availability check's to set OR clear. Any other verdict is about
// something the binary being present cannot answer, so a real failure survives finding one.
const afterAvailability = (state: ProbeState, available: boolean): ProbeState => {
  if (!available) return { kind: "no-claude" };
  return state.kind === "no-claude" ? { kind: "ok" } : state;
};

/** Claude's windows if we can still vouch for them, null once the reading is too old to draw.
 *
 *  Claude only, and the asymmetry is deliberate: Codex's windows are re-read from its rollout file
 *  on every poll at no cost, so there is no "we could not measure" state for them to fall into. The
 *  Claude side is a query the server may be unable to spend. */
export function currentClaudeLimits(snapshot: RateLimitSnapshot, now_ms: number): RateLimits | null {
  const held = snapshot.claude;
  if (!held) return null;
  // Inclusive, so the rule is exactly the one written above it: a reading is dropped when it is
  // OLDER than the age, not when it reaches it (Codex review).
  return now_ms - held.reportedAt_ms <= CLAUDE_READING_MAX_AGE_MS ? held.limits : null;
}

/** Told after a report that carried windows. The agent is part of it because the two callers want
 *  different things from it: the cache wants the snapshot, while the probe wants to know its own
 *  answer is in — a Claude report with windows is the moment holding the PTY open stops buying
 *  anything. */
export type RateLimitChange = (snapshot: RateLimitSnapshot, agent: RateLimitAgent) => void;

export function createRateLimitStore(initial: RateLimitSnapshot = {}, onChange: RateLimitChange = () => {}) {
  const byAgent: RateLimitSnapshot = { ...initial };
  let lastAskedAt_ms: number | null = null;
  let probeInFlight = false;
  let lastProbeAt_ms: number | null = null;
  // When a Claude status line last ANSWERED — carried windows, or proved there are none. Compared
  // against the probe's start to tell "it answered" from "nothing came back", which the state alone
  // cannot: `ok` is also what a store looks like before anything has happened.
  //
  // A status line from before the session's first API response is deliberately not one of these. It
  // says only "claude is running", which is not what the probe was spawned to find out.
  let lastStatusLineAt_ms: number | null = null;
  let state: ProbeState = { kind: "ok" };

  /** A payload without the windows is routine — before the first API response, or API-key
   * billing — so it leaves the last known reading alone rather than blanking the gauge. */
  const record = (agent: RateLimitAgent, limits: RateLimits | null, now_ms: number): void => {
    if (!limits) return;
    byAgent[agent] = { limits, reportedAt_ms: now_ms };
    onChange({ ...byAgent }, agent);
  };

  return {
    /** Codex's windows, read from its rollout file. No probe and no verdict to reach: the file
     * either had them or it did not. */
    reportCodex(limits: RateLimits | null, now_ms: number): void {
      record("codex", limits, now_ms);
    },

    /** One Claude status line. A payload that proves nothing moves nothing — not the state, not the
     * "it answered" stamp — which is what leaves a probe that then dies to be counted as the
     * silence it is (see claudeStatusVerdict).
     *
     * Kept apart from `reportCodex` rather than sharing one `report(agent, …)`: the verdict is
     * Claude's alone, and an agent argument is a way to reach the store without it. */
    reportClaudeStatus(status: ClaudeStatus, now_ms: number): void {
      const verdict = claudeStatusVerdict(status);
      if (verdict) {
        lastStatusLineAt_ms = now_ms;
        state = verdict;
      }
      record("claude", status.limits, now_ms);
    },
    snapshot(): RateLimitSnapshot {
      return { ...byAgent };
    },
    /** Called by the GET route: reading the gauge is what registers the demand that permits the
     * next probe. */
    noteAsked(now_ms: number): void {
      lastAskedAt_ms = now_ms;
    },
    wantsProbe(now_ms: number, staleAfter_ms: number = RATE_LIMIT_STALE_MS): boolean {
      return shouldProbe(now_ms, {
        staleAfter_ms,
        reportedAt_ms: byAgent.claude?.reportedAt_ms ?? null,
        lastAskedAt_ms,
        probeInFlight,
        lastProbeAt_ms,
        state,
      });
    },
    setProbeInFlight(inFlight: boolean): void {
      probeInFlight = inFlight;
    },
    /** A probe is starting now. Stamped BEFORE it runs, so a probe that dies without reporting
     *  still pushes the next attempt out (#1011). */
    noteProbeStarted(now_ms: number): void {
      lastProbeAt_ms = now_ms;
    },
    /** A probe settled. Only the case where NOTHING arrived during it counts as a failure.
     *
     *  Decided by comparing timestamps rather than by reading the state: a store that has never
     *  probed is also `ok`, so treating `ok` as "it worked" would swallow the FIRST failure — and
     *  the first failure is the one that starts the loop this fix exists for (#1011). */
    noteProbeFailedIfNoReport(now_ms: number, stall: ProbeStall = "unknown"): boolean {
      if (answeredDuringAttempt(lastStatusLineAt_ms, lastProbeAt_ms)) return false;
      // The gap is measured from when the attempt ENDED, not when it began. A probe times out
      // after PROBE_TIMEOUT_MS, which is the same 90 seconds as the first retry delay — so
      // measuring from the start would let the first retry fire the instant the timeout landed,
      // reproducing the exact cadence reported in #1011 for one more cycle.
      lastProbeAt_ms = now_ms;
      state = afterSilence(state, stall);
      // Returned so the caller can keep the evidence for exactly the probes that failed. A caller
      // cannot work this out from the state: `no-report` is also what the PREVIOUS failure left
      // behind, so saving on that would overwrite the useful screen with a successful probe's.
      return true;
    },
    /** Whether `claude` can be launched at all, told to the store by whoever can look.
     *
     *  Called on every poll rather than only before a probe: `no-claude` refuses to probe, so a
     *  check that only ran inside the probe path could never clear itself — install claude and the
     *  gauge would stay unavailable until a restart (Codex review on #1019). */
    setClaudeAvailable(available: boolean): void {
      state = afterAvailability(state, available);
    },
    probeState: (): ProbeState => state,
    /** Told to the browser so it can wait for the probe instead of sleeping through it: the probe
     * takes the better part of a minute, so a client on its normal interval would paint an
     * incomplete gauge and leave it that way for minutes. */
    isProbing: (): boolean => probeInFlight,
  };
}

export type RateLimitStore = ReturnType<typeof createRateLimitStore>;
