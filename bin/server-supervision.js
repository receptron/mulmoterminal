// What the launcher does about a server child that just exited: bring it back, stop, or report a
// taken port. The production half of the decision scripts/dev-server-config.js makes for `yarn dev`.
//
// `yarn dev` has restarted the backend on any exit since #734; the shipped launcher exited with
// it. So the developer was protected from a crash and the user was not — and the user is the one
// who cannot fix it, because their sessions are tmux-backed and still alive while the only thing
// that serves them is gone. From a phone there is no way back at all (#2162).
//
// WHY NOT `restartPlan` FROM scripts/. Two reasons, and either is enough:
//   - `scripts/` is not in package.json's `files`, so an import of it from here resolves in the
//     repo and ERR_MODULE_NOT_FOUNDs for everyone who installed the package.
//   - the policy differs. Dev retries EVERY exit forever because a file save is how the developer
//     fixes whatever was wrong. There is no watcher here, and there are exits dev never sees.
//
// Pure on purpose: the rule is the whole risk, and it is reachable only by killing a real server
// otherwise. Nothing here reads a clock, a socket or a process.

/** The exit code `server/index.ts` leaves with when the port was already taken at bind time.
 *  Kept in sync with `PORT_IN_USE_EXIT_CODE` in server/infra/process/server-exit.ts, which a spec pins. */
export const PORT_IN_USE_EXIT_CODE = 75;

/** How long the launcher waits before the first restart, and the ceiling the doubling stops at.
 *  The ceiling has to sit BELOW what the last allowed attempt would otherwise ask for, or it is
 *  decoration that nothing can reach — a spec pins that relationship, because it is the kind of
 *  thing a later change to either number breaks silently. */
export const RESTART_MIN_DELAY_MS = 500;
export const RESTART_MAX_DELAY_MS = 4_000;

/** How many failures in a row are tried before the launcher gives up. A server that binds and then
 *  dies immediately would otherwise be respawned forever, and each boot is expensive — #1735 is
 *  what that cost the machine it happened to: the load average climbed until somebody noticed. */
export const MAX_CONSECUTIVE_RESTARTS = 5;

/**
 * The signals a crashing process raises on ITSELF, enumerated rather than derived.
 *
 * Node aborts on out-of-memory, which arrives as SIGABRT, and a native addon — node-pty here —
 * can take the process down with SIGSEGV or SIGBUS. Those are the crashes worth coming back from.
 *
 * Everything not on this list is treated as a stop somebody asked for, SIGKILL included, and that
 * is a deliberate trade: an OOM killer also sends SIGKILL and that crash is NOT recovered. But
 * `kill -9 <pid>` is what bin/stop.js prints when a server will not stop on its own, and the pid
 * it prints is the server child's — so restarting on SIGKILL would defeat a documented escape
 * hatch. A stop that does not stop is the worse failure of the two.
 */
const CRASH_SIGNALS = new Set(["SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGTRAP"]);

/**
 * Whether this platform can tell a stop from a crash at all.
 *
 * Windows cannot. Node has no real signals there, so a `taskkill` — or a `mulmoterminal stop` the
 * server did not answer over HTTP, which falls back to a signal — TERMINATES the process instead of
 * delivering something its handler runs. The server then never reaches the `exit(0)` that means
 * "somebody asked for this", and the exit arrives as a bare non-zero code with no signal: the exact
 * shape of the crash this module exists to recover from. Restarting on it would resurrect a server
 * the user just stopped, and leave them no way to stop it at all. (The Stop button and an answered
 * `stop` do reach `exit(0)` there since #3234; the fallbacks are what still look like a crash.)
 *
 * So Windows keeps the behaviour it had before supervision existed — the launcher leaves with its
 * server — and says nothing new about it. Fixing it properly means giving `stop` a way to reach
 * the LAUNCHER rather than only the server it spawned, which is a change to the instance registry
 * and to `stop` itself, not to this decision.
 */
const canTellStopFromCrash = (platform) => platform !== "win32";

/**
 * What the launcher should do about an exited server.
 *
 * `everServed` is about THIS LAUNCHER, not this child: it is true once any lifetime has reported
 * `{ type: "listening" }`. A server that has never bound is not worth restarting — nothing was
 * serving, so there is no browser session to bring back, and the same boot fails the same way.
 * That is what keeps a bad config, or a half-unpacked npx cache, from being respawned, and keeps
 * the launcher's npx-cache hint at the end of the output rather than under repeats of one stack.
 *
 * `consecutiveFailures` counts failures in a row and INCLUDES the exit being judged, so 1 is the
 * first. It resets when the server says it is listening — deliberately not on elapsed time: the
 * server does its whole setup before it binds, so "it stayed up N seconds" read every crash as a
 * one-off and the backoff never fired (#1735).
 *
 * `platform` is asked for rather than read from `process` so that a run on one platform can decide
 * about another — and so that nothing here depends on ambient state.
 *
 * @param {{ code: number | null, signal: string | null, everServed: boolean,
 *           consecutiveFailures: number, platform: string }} exit
 * @returns {{ action: "port-in-use" | "restart" | "stop", delayMs: number, reason: string | null }}
 */
export function planAfterServerExit({ code, signal, everServed, consecutiveFailures, platform }) {
  // A port that is taken will still be taken next time; the caller names who has it and stops.
  if (code === PORT_IN_USE_EXIT_CODE) return { action: "port-in-use", delayMs: 0, reason: null };
  // `mulmoterminal stop` and the browser's Stop button both end in the server's own shutdown, which
  // exits 0 (server/infra/process/shutdown.ts). Restarting that is the product's stop button not stopping.
  if (code === 0) return { action: "stop", delayMs: 0, reason: null };
  // Nothing below can be decided on a platform where a stop and a crash arrive identically, so it
  // is not guessed at: the launcher leaves with its server, exactly as it did before (see above).
  if (!canTellStopFromCrash(platform)) return { action: "stop", delayMs: 0, reason: null };
  const how = signal ? `signal ${signal}` : `code ${code}`;
  if (signal && !CRASH_SIGNALS.has(signal))
    return {
      action: "stop",
      delayMs: 0,
      reason: `Server ended on ${signal} — that is how a stop is delivered, not how a crash arrives, so it is not being restarted.`,
    };
  if (!everServed)
    return {
      action: "stop",
      delayMs: 0,
      reason: `Server exited (${how}) without ever reaching the port — a restart would fail the same way, and no browser session is waiting on it. What it printed above is the reason.`,
    };
  if (consecutiveFailures > MAX_CONSECUTIVE_RESTARTS)
    return {
      action: "stop",
      delayMs: 0,
      reason: `Server exited (${how}) and has now failed ${consecutiveFailures} times in a row — giving up rather than restarting it forever. Fix what it reports above, then start it again.`,
    };
  // Doubling from the COUNT rather than from the previous delay: the caller holds no delay state,
  // so there is none to get out of step with the attempt it describes.
  const delayMs = Math.min(RESTART_MIN_DELAY_MS * 2 ** (consecutiveFailures - 1), RESTART_MAX_DELAY_MS);
  return {
    action: "restart",
    delayMs,
    reason: `Server exited (${how}) — restarting in ${delayMs}ms (attempt ${consecutiveFailures} of ${MAX_CONSECUTIVE_RESTARTS}). Terminals are tmux-backed, so they reattach.`,
  };
}
