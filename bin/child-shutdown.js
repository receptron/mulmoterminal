// How a parent stops its server: a message on the IPC channel both of its parents already open (the
// launcher and `yarn dev`), not a signal. On Windows a signal to ANOTHER process is
// TerminateProcess — the server's own handler never runs, and what it would have flushed to disk
// is lost (#3234). A message is handled the same way on every platform.

export const SHUTDOWN_MESSAGE_TYPE = "shutdown";

/** @param {unknown} message */
export function isShutdownMessage(message) {
  return typeof message === "object" && message !== null && "type" in message && message.type === SHUTDOWN_MESSAGE_TYPE;
}

/**
 * Ask a child server to run its own shutdown. Over the channel when there is one; a signal is the
 * fallback for a child with no channel, or one the message could not reach.
 *
 * @param {{ connected: boolean, send: (message: unknown, callback: (error: Error | null) => void) => boolean, kill: (signal?: NodeJS.Signals) => boolean }} child
 */
export function askChildToStop(child) {
  if (!child.connected) {
    child.kill("SIGTERM");
    return;
  }
  child.send({ type: SHUTDOWN_MESSAGE_TYPE }, (error) => {
    if (error) child.kill("SIGTERM");
  });
}

export const CHILD_EXIT_GRACE_MS = 2000;

/** Ask the child to stop, and end it outright if it has not closed within `graceMs` — asking no
 *  longer comes with a signal that would have ended it anyway, and a child left running holds the
 *  port. `onGone` runs once, whichever comes first. */
export function stopChildWithin(child, graceMs, onGone = () => {}) {
  let gone = false;
  const finish = () => {
    if (gone) return;
    gone = true;
    clearTimeout(giveUp);
    onGone();
  };
  const giveUp = setTimeout(() => {
    child.kill("SIGKILL");
    finish();
  }, graceMs);
  giveUp.unref?.();
  child.once("close", finish);
  askChildToStop(child);
}

/** Ctrl+C reaches the child too (the signal goes to the whole process group), and the child now
 *  flushes queued session state before it exits (#2161). Exiting here the instant we have
 *  signalled would hand the shell back first and, when the terminal then goes away, cut that
 *  flush short — so we wait for the child's own exit.
 *
 *  ASKED over the IPC channel, not signalled: on Windows a signal to the child is TerminateProcess,
 *  which ended it before that flush could run (#3234).
 *
 *  Capped, because a child that will not die must not leave the user unable to get their prompt
 *  back. Past the cap the child is killed and we go.
 *
 *  `getChild` rather than the child itself: it is replaced across restarts and bind-retries, and
 *  the handler is registered once. `onStopping` is for a parent that must stop restarting it. */
export function installParentShutdown(
  getChild,
  { graceMs = CHILD_EXIT_GRACE_MS, exit = (code) => process.exit(code), on = (sig, fn) => process.on(sig, fn), onStopping = () => {} } = {},
) {
  let shuttingDown = false;
  const shutdown = () => {
    const child = getChild();
    // A second Ctrl+C means "stop waiting", not "signal twice".
    if (shuttingDown || !child) return exit(0);
    // A child that has already gone emits no further `close`, so waiting for one would spend the
    // whole grace period doing nothing — Ctrl+C after a crash would feel like a hang (Codex on
    // #2195 called this bounded and escapable; it is, and it is also free to avoid).
    if (child.exitCode !== null || child.signalCode !== null) return exit(0);
    shuttingDown = true;
    onStopping();
    stopChildWithin(child, graceMs, () => exit(0));
  };
  on("SIGINT", shutdown);
  on("SIGTERM", shutdown);
}
