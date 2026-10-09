// Usage windows for each ACCOUNT (#2215) — a second login's 5h / 7d, shown beside the default one's.
//
// The default login keeps the store it always had (rate-limit-service.ts) and nothing here touches
// it. Each account gets a store of its own — the same one, with the same probe gate and backoff —
// so a login that is not signed in yet backs off on its own schedule without holding up the others,
// and its readings are cached in a file of its own (rate-limit-persist.ts).
//
// Codex is read from the account's own rollouts, free on every poll. Claude needs a probe, exactly
// as the default does: a hidden session started under the account's CLAUDE_CONFIG_DIR, whose
// statusLine reports to `/api/rate-limits?probe=<key>`, a key minted for that probe, so the reading
// lands in the login it measured — not in whatever the account id names by the time it answers.
import { randomBytes } from "node:crypto";
import type { AgentAccount } from "../../../common/agentAccounts.js";
import type { RateLimits } from "../../../common/rateLimits.js";
import { createRateLimitStore, currentClaudeLimits, type ProbeState, type RateLimitStore } from "./rate-limit-store.js";
import { createRateLimitCacheWriter, rateLimitCacheFile, readRateLimitCache } from "./rate-limit-persist.js";
import type { ClaudeStatus } from "../statusline.js";
import type { ProbeStall } from "../probe/probe-stall.js";

/** What one account's gauge needs, as the route sends it. */
export interface AccountRateLimitReading {
  id: string;
  label: string;
  agent: AgentAccount["agent"];
  limits: RateLimits | null;
  probing: boolean;
  probe: ProbeState["kind"];
  probeStall: ProbeStall | undefined;
  /** The windows as last read, however old; sent only while `limits` is null, so a login held out at
   *  its limit can still say when its windows were due to reset. */
  lastLimits?: RateLimits;
  /** The sign-in address a rotation token's entry names (#2919); absent for an account. */
  email?: string;
  /** A rotation token rather than an account (#2919) — what the token usage screen lists. */
  rotation?: true;
}

/** What a meter needs to know about the thing it measures: an account, or a rotation token (#2919). */
export type MeteredLogin = Pick<AgentAccount, "id" | "label" | "agent"> & { email?: string };

export interface AccountRateLimitDeps<T extends MeteredLogin = AgentAccount> {
  /** The configured accounts, read live so an added one is measured without a restart. */
  accounts: () => readonly T[];
  /** The account's home, absolute. */
  homeOf: (account: T) => string;
  /** Which subscription a reading belongs to. Defaults to the agent and home; rotation tokens share
   *  one home, so they name themselves instead. */
  loginOf?: (account: T) => string;
  /** The newest windows in a codex home's rollouts, or null. */
  readCodex: (home: string) => RateLimits | null;
  /** Start a Claude probe under this home, whose statusLine reports with `probeReportKey`; returns its
   *  stop function. `onSettled` reports whether the statusLine ever answered. */
  startClaudeProbe: (home: string, probeReportKey: string, onSettled: (stall: ProbeStall) => void, account: T) => () => void;
  claudeAvailable: () => boolean;
  /** Where a login's readings are cached; a spec points it away from ~/.mulmoterminal. */
  cacheFile?: (login: string) => string;
}

/** One account's gauge, from its store: Claude's windows only while they are recent enough to vouch
 *  for (the same rule as the default's), Codex's as last read. */
function readingOf(account: MeteredLogin, store: RateLimitStore, now_ms: number): AccountRateLimitReading {
  const snapshot = store.snapshot();
  const state = store.probeState();
  const limits = account.agent === "claude" ? currentClaudeLimits(snapshot, now_ms) : (snapshot.codex?.limits ?? null);
  const lastLimits = limits === null && account.agent === "claude" ? snapshot.claude?.limits : undefined;
  return {
    id: account.id,
    label: account.label,
    agent: account.agent,
    limits,
    probing: store.isProbing(),
    probe: state.kind,
    probeStall: state.kind === "no-report" ? state.stall : undefined,
    ...(account.email ? { email: account.email } : {}),
    ...(lastLimits ? { lastLimits } : {}),
  };
}

interface Meter {
  store: RateLimitStore;
  stopProbe: (() => void) | null;
}

const PROBE_REPORT_KEY_BYTES = 8;

/** A login's meter, seeded from its cache file and registered under the login. */
function newMeter(login: string, cacheFile: (login: string) => string, meters: Map<string, Meter>): Meter {
  const file = cacheFile(login);
  const write = createRateLimitCacheWriter(file);
  // The change hook is where the default service stops its probe once windows arrive; an
  // account's does the same, and persists its own snapshot.
  const store = createRateLimitStore(readRateLimitCache(file), (snapshot, agent) => {
    write(snapshot);
    if (agent === "claude") meters.get(login)?.stopProbe?.();
  });
  const meter: Meter = { store, stopProbe: null };
  meters.set(login, meter);
  return meter;
}

export function createAccountRateLimits<T extends MeteredLogin = AgentAccount>(deps: AccountRateLimitDeps<T>) {
  const meters = new Map<string, Meter>();
  // A running probe's report key → the login it measures. Removed when the probe settles, so a key
  // is only good for as long as its probe is.
  const probeLogins = new Map<string, string>();

  // A meter measures a LOGIN — an agent's home — not an account id: the id is a name the user can
  // reuse for another home, and a reading follows the subscription, not the name.
  const loginOf = (account: T): string => deps.loginOf?.(account) ?? `${account.agent}:${deps.homeOf(account)}`;

  const meterFor = (account: T): Meter => {
    const login = loginOf(account);
    return meters.get(login) ?? newMeter(login, deps.cacheFile ?? rateLimitCacheFile, meters);
  };

  const startProbe = (account: T, meter: Meter, now_ms: number): void => {
    meter.store.setProbeInFlight(true);
    meter.store.noteProbeStarted(now_ms);
    const probeReportKey = randomBytes(PROBE_REPORT_KEY_BYTES).toString("hex");
    probeLogins.set(probeReportKey, loginOf(account));
    try {
      meter.stopProbe = deps.startClaudeProbe(
        deps.homeOf(account),
        probeReportKey,
        (stall) => {
          probeLogins.delete(probeReportKey);
          meter.stopProbe = null;
          meter.store.noteProbeFailedIfNoReport(Date.now(), stall);
          meter.store.setProbeInFlight(false);
        },
        account,
      );
    } catch {
      probeLogins.delete(probeReportKey);
      // A probe that could not even start (a rotation token that cannot be read) is a failed attempt,
      // so it backs off like one instead of being retried on every refresh.
      meter.store.noteProbeFailedIfNoReport(Date.now());
      meter.store.setProbeInFlight(false);
    }
  };

  const refreshOne = (account: T, now_ms: number): void => {
    const meter = meterFor(account);
    meter.store.noteAsked(now_ms);
    if (account.agent === "codex") {
      meter.store.reportCodex(deps.readCodex(deps.homeOf(account)), now_ms);
      return;
    }
    meter.store.setClaudeAvailable(deps.claudeAvailable());
    if (meter.store.wantsProbe(now_ms)) startProbe(account, meter, now_ms);
  };

  return {
    /** A poll: read every codex account, and probe every claude account that is due. */
    refresh(now_ms: number): void {
      deps.accounts().forEach((account) => refreshOne(account, now_ms));
    },
    /** One Claude status line from an account's probe, filed under the login that probe measured.
     *  A key no running probe holds is dropped: nothing else could have asked for it. */
    reportClaudeStatus(probeReportKey: string, status: ClaudeStatus, now_ms: number): void {
      const login = probeLogins.get(probeReportKey);
      const meter = login === undefined ? undefined : meters.get(login);
      meter?.store.reportClaudeStatus(status, now_ms);
    },
    /** Every configured account's reading, in config order. Empty when there are none — which is
     *  what keeps the route's response exactly as it was for a user without accounts. */
    readings(now_ms: number): AccountRateLimitReading[] {
      return deps.accounts().map((account) => readingOf(account, meterFor(account).store, now_ms));
    },
    /** One login's last Claude windows however old, for a decision that would rather have a stale
     *  number than none (token-choice.ts); null when it was never measured. */
    lastClaudeLimits(account: T): RateLimits | null {
      return meterFor(account).store.snapshot().claude?.limits ?? null;
    },
  };
}

export type AccountRateLimits = ReturnType<typeof createAccountRateLimits<AgentAccount>>;
