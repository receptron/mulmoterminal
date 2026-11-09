// The 5h / 7d rate-limit gauge (#387), assembled: the store, Codex's free reading, and Claude's
// probe with the lifetime rules that surround it.
//
// Its own module rather than index.ts's because none of it is boot ORDER — it is one subsystem
// with a single seam, and the object this returns is exactly what the /api/rate-limits routes
// take. index.ts keeps the call and the moment it happens.
import { mkdirSync } from "node:fs";
import { createRateLimitStore } from "./rate-limit-store.js";
import { startRateLimitProbe, probeSpawnEnv } from "./rate-limit-probe.js";
import { newProbeSessionId } from "../probe/probe-session.js";
import { probeCwd } from "../probe/probe-cwd.js";
import { ensureProbeFolderTrusted, isProbeFolderItself } from "../probe/probe-trust.js";
import { claudeProjectPath, claudeUserConfigFile } from "../../session/project-dir.js";
import { writeProbeScreen } from "../probe/probe-stall.js";
import { removeProbeTranscript } from "../probe/probe-transcript.js";
import { newestRolloutFile, readRolloutTail } from "../codex/codex-rollout.js";
import { codexSessionsRoot } from "../codex/codex-session.js";
import { createAccountRateLimits, type AccountRateLimitReading } from "./account-rate-limits.js";
import { createTokenRotation, type TokenRotationRuntime } from "../token/token-rotation-service.js";
import type { ProbeStall } from "../../../common/probeStall.js";
import { accountHome, codexSessionsUnder, distinctAccounts, homeEnv } from "../../session/session-home.js";
import { latestRateLimitsInRollout } from "../codex/codex-rate-limits.js";
import { rateLimitCacheFile, readRateLimitCache, createRateLimitCacheWriter } from "./rate-limit-persist.js";
import type { RateLimitRouteDeps, LoginRateLimits } from "./rate-limit-routes.js";
import type { ProbeOutcome } from "./rate-limit-probe.js";
import { hasBinary } from "../../infra/process/has-binary.js";
import { spawnPty } from "../../session/pty/pty-spawn.js";
import { AGENT_BINS } from "../../config/agent/agent-bins.js";
import { MULMOTERMINAL_HOME, PORT } from "../../config/env.js";

// Long enough for claude's own final write to land after the PTY is killed. Deleting into that
// window loses the race and the file comes back — and a transcript that reappears reads exactly
// like the bug this fixes (#1010).
const TRANSCRIPT_FLUSH_MS = 5_000;

// Whether a probe could even run. Checked before spawning rather than discovered by spawning
// (#1011): a machine without `claude` used to fail so fast that it never reached the 90s timeout,
// so the store learned nothing and the next poll tried again — a spawn attempt per poll.
const claudeIsRunnable = (): boolean => {
  try {
    return hasBinary(AGENT_BINS.claude);
  } catch {
    return false;
  }
};

// Every probe — the default login's, an account's, a rotation token's — runs here, never in the
// workspace (#3200): see probe-cwd.ts. Trust for it is still per login, which is why an account's
// probe meets the prompt on its own.
const PROBE_CWD = probeCwd(MULMOTERMINAL_HOME);

// Config files a READ has found holding the folder's trust, so each login's is read once per server
// rather than on every probe — the file runs to a megabyte on a long-lived install. A write is not
// recorded: Claude Code's own save can land on top of it (probe-trust.ts), so the next probe reads
// again and finds it, or writes again. A user who removes the entry after that read gets the
// trust-prompt note until the server restarts, which is the by-hand path working as documented.
const configFilesTrustingProbeFolder = new Set<string>();

// Trust for the folder goes in the config of the login the probe runs on (#3206): an account's own
// CLAUDE_CONFIG_DIR, else the server's default — which is also what a rotation token's probe reads.
// Keyed by the folder's real path, which is what claude sees as its cwd — so a folder that is a
// LINK gets no trust at all, since the real path would then be somebody else's directory.
const markProbeFolderTrusted = (cwd: string, loginEnv: Record<string, string>): void => {
  const configFile = claudeUserConfigFile(loginEnv.CLAUDE_CONFIG_DIR);
  if (configFilesTrustingProbeFolder.has(configFile) || !isProbeFolderItself(cwd)) return;
  if (ensureProbeFolderTrusted(configFile, claudeProjectPath(cwd)) === "trusted") configFilesTrustingProbeFolder.add(configFile);
};

// The folder is made on the way in rather than at boot, so one removed while the server runs costs
// a probe, not the gauge. A folder that cannot be made fails the spawn, and startRateLimitProbe
// already reports a spawn that threw as a probe that brought nothing back. Trust that cannot be
// written is not a failure here: the probe runs anyway, and its stall names the prompt.
const spawnProbe = (args: string[], cwd: string, unset: readonly string[], loginEnv: Record<string, string>) => {
  mkdirSync(cwd, { recursive: true });
  markProbeFolderTrusted(cwd, loginEnv);
  return spawnPty(AGENT_BINS.claude, args, cwd, unset, probeSpawnEnv(loginEnv));
};

// A probe that stopped for a reason nothing here can name. The screen is the only evidence there
// is, and without it the next report of "usage says n/a" starts from nothing (#1293).
const reportProbeScreen = (screen: string): void => {
  if (!screen) return;
  const file = writeProbeScreen(MULMOTERMINAL_HOME, screen);
  if (file) console.warn(`[rate-limit] the usage probe reported nothing; what its terminal showed is in ${file}`);
};

/** A Claude usage probe in `home`, started with `env` laid over the server's environment minus
 *  `unset` — an account's home variable, or a rotation token. */
export function startHomeProbe(
  home: string,
  probeReportKey: string,
  onSettled: (stall: ProbeStall) => void,
  unset: readonly string[],
  env: Record<string, string>,
  settingsEnv: Record<string, string> = {},
) {
  const sessionId = newProbeSessionId();
  return startRateLimitProbe({
    spawn: (args, cwd) => spawnProbe(args, cwd, unset, env),
    host: "localhost",
    port: PORT,
    cwd: PROBE_CWD,
    sessionId,
    probeReportKey,
    settingsEnv,
    onSettled: ({ stall }) => {
      onSettled(stall);
      setTimeout(() => void removeProbeTranscript(PROBE_CWD, sessionId, home).catch(() => {}), TRANSCRIPT_FLUSH_MS).unref();
    },
  });
}

/** Each configured account's meter (#2215): Codex read from the account's own rollouts, Claude probed
 *  under the account's own login — the same variable its cells are started with (session-home.ts). */
const accountMeters = () =>
  createAccountRateLimits({
    accounts: distinctAccounts,
    homeOf: (account) => accountHome(account),
    readCodex: (home) => {
      const file = newestRolloutFile(codexSessionsUnder(home), Date.now());
      return file ? latestRateLimitsInRollout(readRolloutTail(file)) : null;
    },
    startClaudeProbe: (home, probeReportKey, onSettled) => startHomeProbe(home, probeReportKey, onSettled, [], homeEnv("claude", home)),
    claudeAvailable: claudeIsRunnable,
  });

/** What index.ts takes: the routes' deps, and the choice of credential for a new session (#2919). */
export type RateLimitService = Omit<RateLimitRouteDeps, "usageGauge"> & Omit<TokenRotationRuntime, "meters">;

/** The accounts' meters and the rotation tokens' meters, as the one list the routes read. A probe's
 *  report key is minted by the meter that started it, so at most one of the two knows it. */
const combinedMeters = (parts: readonly LoginRateLimits[]): LoginRateLimits => ({
  refresh: (now_ms, staleAfter_ms) => parts.forEach((part) => part.refresh(now_ms, staleAfter_ms)),
  reportClaudeStatus: (key, status, now_ms) => parts.forEach((part) => part.reportClaudeStatus(key, status, now_ms)),
  readings: (now_ms): AccountRateLimitReading[] => parts.flatMap((part) => part.readings(now_ms)),
});

/** The gauge's store and the three things the routes ask of it.
 *
 *  Codex is free — its rollout file holds the windows — while Claude needs a hidden probe session,
 *  so the store decides when spending a query is warranted. Neither agent being installed is not a
 *  case to handle: no rollout means no Codex reading, and a probe that cannot launch simply never
 *  reports, which is the same as having no data yet. Seeded from the last run so the header has
 *  numbers the moment the grid opens; probing at boot instead would spend a query on every restart
 *  — once per SAVE under `yarn dev`. */
export function createRateLimitService(liveSessions: (tokenId: string) => number = () => 0): RateLimitService {
  // Stopping the probe the moment its answer lands. Without this the PTY was held for the full
  // PROBE_TIMEOUT_MS — the status line arrives in seconds, so most of that minute and a half was a
  // live `claude` process with nothing left to say, and `probing: true` kept every browser polling
  // at seconds rather than minutes for the whole of it.
  //
  // Only a report carrying WINDOWS ends it. The status line also fires before the first API
  // response, when `rate_limits` is not there yet (see statusline.ts) — stopping on that would kill
  // the probe just before the thing it was spawned to collect.
  let stopClaudeRateLimitProbe: (() => void) | null = null;

  const writeRateLimitCacheIfChanged = createRateLimitCacheWriter(rateLimitCacheFile());
  const store = createRateLimitStore(readRateLimitCache(rateLimitCacheFile()), (snapshot, agent) => {
    writeRateLimitCacheIfChanged(snapshot);
    if (agent === "claude") stopClaudeRateLimitProbe?.();
  });

  const refreshCodex = (): void => {
    const file = newestRolloutFile(codexSessionsRoot(), Date.now());
    if (file) store.reportCodex(latestRateLimitsInRollout(readRolloutTail(file)), Date.now());
  };

  // A probe that settles WITHOUT the status line having reported is the "asked, heard nothing"
  // case. report() has already moved the state on if anything arrived, so this only widens the gap
  // when nothing did.
  const onProbeSettled = (sessionId: string, { stall, screen }: ProbeOutcome): void => {
    // Cleared here rather than by whoever called stop(): `stop()` is idempotent, but a stale
    // reference would let the NEXT probe be killed by a late report belonging to this one.
    stopClaudeRateLimitProbe = null;
    // Only a probe that failed for a reason we cannot name leaves its screen behind — a named one
    // is already on the gauge, and a successful one has nothing to explain (#1293).
    if (store.noteProbeFailedIfNoReport(Date.now(), stall) && stall === "unknown") reportProbeScreen(screen);
    store.setProbeInFlight(false);
    // Hiding it from /api/sessions is not enough: `claude --resume` reads the transcript directory
    // itself, so the probe has to take its own file with it (#1010).
    setTimeout(() => void removeProbeTranscript(PROBE_CWD, sessionId).catch(() => {}), TRANSCRIPT_FLUSH_MS).unref();
  };

  const startProbe = (): void => {
    // Belt and braces: the route has already refused to want a probe when claude is missing, but
    // this is the last point before a spawn and the flag it would strand is set by the caller.
    if (!claudeIsRunnable()) {
      store.setClaudeAvailable(false);
      store.setProbeInFlight(false);
      return;
    }
    store.noteProbeStarted(Date.now());
    const sessionId = newProbeSessionId();
    stopClaudeRateLimitProbe = startRateLimitProbe({
      spawn: (args, cwd) => spawnProbe(args, cwd, [], {}),
      host: "localhost",
      port: PORT,
      cwd: PROBE_CWD,
      sessionId,
      onSettled: (outcome) => onProbeSettled(sessionId, outcome),
    });
  };

  const accounts = accountMeters();
  const { meters: tokenMeters, ...rotationControls } = createTokenRotation({
    startHomeProbe,
    claudeAvailable: claudeIsRunnable,
    defaultLoginLimits: () => store.snapshot().claude?.limits ?? null,
    liveSessions,
  });
  return {
    store,
    refreshCodex,
    startProbe,
    probeCwd: PROBE_CWD,
    claudeAvailable: claudeIsRunnable,
    now_ms: () => Date.now(),
    accounts: combinedMeters([accounts, tokenMeters]),
    ...rotationControls,
  };
}
