// `POST /api/shutdown` — stop the server from the browser (#1820).
//
// Until now the only way to stop MulmoTerminal was Ctrl+C in the terminal that started it, and
// `npx mulmoterminal@latest` opens a browser — so the user's attention is here, and the terminal
// is what gets lost. Closing the tab does nothing; the server keeps running.
//
// MulmoClaude answers the same need at the same path with the same body, and this is a copy of
// that decision rather than a second opinion: someone running both hosts must not find two
// different ways to stop them (../mulmoclaude/server/api/routes/shutdown.ts, #2616).
//
// ONE DELIBERATE DIVERGENCE from it: MulmoClaude's note says the route is reachable from the local
// machine only because its server binds 127.0.0.1. That is not true here — BIND_HOST can be a real
// interface, and `bindSecurityWarning` exists for exactly that. It adds no new class of privilege,
// because whoever can reach an exposed server can already spawn an agent on it, but the reason is
// different and should not be copied over as if it were the same.
//
// No origin check of its own: `sameOriginGuard` is mounted before every route in app-routes.ts and
// covers every state-changing method, which is the whole point of it being central — a route added
// today is covered by default rather than by memory.
import type { Express } from "express";
import { requestShutdown } from "../infra/process/shutdown.js";

// Zero would race the response: the socket can close before the browser has read it, and the user
// sees a failed request from a button that in fact worked. Same value as MulmoClaude's
// SHUTDOWN_RESPONSE_GRACE_MS, for the same reason.
const SHUTDOWN_RESPONSE_GRACE_MS = 250;

export interface ShutdownRouteDeps {
  /** Injected so the request can be observed in a test without the test process dying. */
  stop: () => void;
  delayMs: number;
}

// The same function the signal handlers call, so the button provably does what Ctrl+C does. Not a
// SIGTERM to ourselves: on Windows that is TerminateProcess even for our own pid, so the drain
// never ran (#3234).
const defaultDeps: ShutdownRouteDeps = {
  stop: requestShutdown,
  delayMs: SHUTDOWN_RESPONSE_GRACE_MS,
};

/** Answer first, stop second — the browser needs the reply to put its "stopped" screen up, and
 *  stopping inside the handler closes the socket first, which makes a click that worked look like
 *  a failure. */
export function mountShutdownRoute(app: Express, deps: ShutdownRouteDeps = defaultDeps): void {
  app.post("/api/shutdown", (_req, res) => {
    console.log("[shutdown] stop requested (the Stop button or `mulmoterminal stop`)");
    res.json({ stopping: true });
    // unref so a pending stop is not itself the reason the process stays alive.
    setTimeout(deps.stop, deps.delayMs).unref();
  });
}
