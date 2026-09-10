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

// The listener parameters are written out rather than taken from a node type. `ProcessEventMap`
// was the named replacement for the deprecated NodeJS.*Listener aliases, but it does not exist in
// every @types/node this repo builds against — it is absent in 22 and present in 26 — so importing
// it makes a dependency bump a build break in a file that has nothing to do with the bump.
//
// `unknown` is deliberate on both, and not just for portability: node hands `uncaughtException`
// whatever was thrown, and `throw "boom"` is not an Error. Node's own declaration says `Error`, so
// typing it that way would delete the `instanceof` check below as provably-true and lose the
// non-Error case. A wider parameter is still assignable to node's narrower listener type.
const onUnhandledRejection = (reason: unknown) => {
  console.error("[fatal] unhandledRejection — process kept alive:", reason instanceof Error ? (reason.stack ?? reason) : reason);
};

const onUncaughtException = (err: unknown) => {
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
