// Top-level safety net for the backend process. Without these, a single uncaught error
// anywhere in the server — most often an unhandled 'error' event on a node-pty child or a
// rejected promise inside a WebSocket handler — exits the whole Express process. When that
// happens under `node --watch`, nothing restarts it (watch only restarts on file changes,
// not on a crash), so every terminal's WebSocket and every /api poll starts hitting a dead
// port: the Vite dev proxy then floods the console with `ws proxy error` / `http proxy
// error` + `ECONNREFUSED` and, to the user, "all terminals disconnected at once".
//
// The trade-off: continuing after an uncaughtException is officially discouraged (process
// state may be corrupt). We accept it deliberately — for this app, one session left in an
// inconsistent state is far better than taking down every other terminal with it. The
// logged stack is also what lets us find and fix the real emitter (Step B). A genuinely
// fatal bind failure still exits, because server.on("error") in index.ts runs its own
// process.exit before anything reaches here.
import { messageOf } from "../errors.js";

const onUnhandledRejection: NodeJS.UnhandledRejectionListener = (reason) => {
  console.error("[fatal] unhandledRejection — process kept alive:", reason instanceof Error ? (reason.stack ?? reason) : reason);
};

const onUncaughtException: NodeJS.UncaughtExceptionListener = (err) => {
  console.error(`[fatal] uncaughtException — process kept alive: ${messageOf(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
};

// Idempotent: registers exactly one of each handler, so repeated calls don't stack listeners
// or trip Node's MaxListenersExceededWarning. Keyed on the handler references actually being
// attached (not a module-level flag) so it stays correct if a caller detaches them.
export function installProcessGuards(): void {
  if (!process.listeners("unhandledRejection").includes(onUnhandledRejection)) process.on("unhandledRejection", onUnhandledRejection);
  if (!process.listeners("uncaughtException").includes(onUncaughtException)) process.on("uncaughtException", onUncaughtException);
}
