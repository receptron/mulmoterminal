// How this process ends, in one place.
//
// The whisper sidecar is a spawned child that won't die with the parent on a signal, and adding a
// signal listener suppresses Node's default termination — so the sidecar has to be killed and the
// exit made explicit. `exit` covers the normal-return path, where no signal is involved.
//
// It lives here rather than at the foot of index.ts because it is about to have a second caller:
// stopping MulmoTerminal from the browser (#1820) has to run THIS path and not a second one that
// drifts from it — the guarantee a user is owed is that the button does what Ctrl+C does.
//
// The exit is ASYNC now, and that is the fix for #2161: the session registry's appends are
// fire-and-forget, `process.exit()` runs no pending microtask, and a burst queued just before
// Ctrl+C was therefore lost whole — measured at 0 of 20 lines, with the file never created. The
// wait is capped, because a disk that has stopped answering must not turn Ctrl+C into a hang.
//
// `exit` cannot wait — the event loop is already over by then — so it stays synchronous and
// drains nothing. That is why `requestShutdown` is the one that matters: Ctrl+C, the browser's stop
// button and a parent's message all reach it — never a signal sent from one process to another,
// which on Windows ends the target without running any of this (#3234).
import { stopWhisperSidecar } from "../../backends/media/whisper.js";
import { drainPersistQueues } from "../../session/reaping/persist-drain.js";
import { isShutdownMessage } from "../../../bin/child-shutdown.js";

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Where a parent's request to stop arrives: the IPC channel, which is `process` itself. */
export interface ShutdownChannel {
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export function installShutdownHandlers(channel: ShutdownChannel = process): void {
  // Installing handlers marks the start of a process lifecycle, so the once-only latches start
  // fresh with it. Production calls this once; a spec calls it per test, and without this the
  // first test to stop the sidecar would leave every later one looking at an already-stopped one.
  sidecarStopped = false;
  stopping = false;
  process.once("exit", stopSidecarOnce);
  // A parent asks over the channel because on Windows its signal would be TerminateProcess (#3234).
  channel.on("message", (message) => {
    if (isShutdownMessage(message)) requestShutdown();
  });
  for (const signal of SIGNALS) {
    // `once`, not `on`, and that now carries a second guarantee worth stating: after the handler
    // fires the listener is gone, so Node's default action is restored and a SECOND Ctrl+C during
    // the drain terminates immediately (measured: exit 130). Switching this to `on` would make the
    // server unkillable for the length of the cap.
    process.once(signal, requestShutdown);
  }
}

/** Kill the sidecar first: it is synchronous, and it must not outlive us whether or not the drain
 *  finishes. Then flush what is owed to disk, under a cap, and go. */
/** Stop the sidecar at most once, and never let it stop US.
 *
 *  ONCE, because the signal path calls `process.exit`, which emits `exit`, whose listener is this
 *  same cleanup — so a sidecar that throws deterministically would throw again from inside the
 *  exit handler and print an uncaught stack on the way out (Codex on #2195).
 *
 *  AND NEVER let it stop us: before the drain this function was two statements and a throw took
 *  the process down with it, which was survivable. Now a throw on the signal path would reject a
 *  promise nobody awaits and leave a process whose default termination is suppressed — a server
 *  that ignores Ctrl+C. Stopping the sidecar is cleanup, not the point of shutting down. */
let sidecarStopped = false;
function stopSidecarOnce(): void {
  if (sidecarStopped) return;
  sidecarStopped = true;
  try {
    stopWhisperSidecar();
  } catch (e) {
    console.warn(`[shutdown] the whisper sidecar did not stop cleanly: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Run the shutdown, once — whoever asks: a signal, the browser's stop button, or a parent's message.
 *
 *  ONCE, because one Ctrl+C on POSIX arrives twice: the terminal signals the whole process group
 *  and the launcher also sends its message. A later request while the drain runs changes nothing;
 *  a second Ctrl+C still ends it at once, since the signal listener was `once`. */
let stopping = false;
export function requestShutdown(): void {
  if (stopping) return;
  stopping = true;
  void stopAndExit();
}

async function stopAndExit(): Promise<void> {
  stopSidecarOnce();
  const drained = await drainPersistQueues();
  if (!drained) console.warn("[shutdown] gave up waiting for queued session state to reach disk; some of it is lost");
  process.exit(0);
}
