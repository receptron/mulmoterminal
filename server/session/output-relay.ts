// Every buffered pty's output path: keep the replay tail, and hand the browser batches
// rather than one frame per read.
//
// The batching exists because of the tail fix, not beside it. Draining a flooding pty at full
// speed makes each read SMALLER, so the same output arrives as far more chunks — six cells went
// from 118k to 655k in one measurement (#1506). One frame each would move the cost we just
// removed from appendBoundedOutput onto JSON.stringify and the socket.
import { containsTerminalQuery, growOutputTail, terminalQueryPrefixTail } from "./terminal-replay.js";
import { sendFrame } from "./ws-frames.js";
import type { PtyEntry } from "./types.js";

// Below one 60fps frame, so a batch can never be seen as lag; large enough that a flood
// collapses into a handful of frames a second instead of thousands.
const FLUSH_INTERVAL_MS = 8;

// A batch this big has already amortised the per-frame cost, and the queue only grows while the
// loop is busy enough that the timer cannot fire — so without a ceiling one burst decides how long
// a single stringify-and-send blocks. Measured batches run ~30 KB; this is the pathological case.
const MAX_BATCH_CHARS = 256 * 1024;

// Long enough to bridge any terminal query we recognise when node-pty splits it across reads.
// Kept independently of the pending output: the first half may already have been sent in an
// immediate frame, while xterm's parser is still waiting for the terminator in the next one.
const QUERY_SCAN_TAIL_CHARS = 64;
const ESC = String.fromCharCode(0x1b);

export interface OutputRelay {
  /** Keep a chunk for replay, and queue it for the browser. */
  push(data: string): void;
  /** Send what is queued. Call before an exit frame, or the last output lands after it. */
  flush(): void;
  /** Forget what is queued, for a caller that has already sent it another way. */
  discard(): void;
}

export function createOutputRelay(entry: PtyEntry, limit: number): OutputRelay {
  const pending: string[] = [];
  let pendingChars = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentMs = 0;
  let queryScanTail = "";

  const clearPending = () => {
    pending.length = 0;
    pendingChars = 0;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const discard = () => {
    clearPending();
    queryScanTail = "";
  };

  const flush = () => {
    if (pending.length === 0) return clearPending();
    const data = pending.join("");
    clearPending();
    lastSentMs = Date.now();
    // Read the socket now, not at push time: a reattach swaps it while a batch is queued.
    sendFrame(entry.ws, { type: "output", data });
  };

  const push = (data: string) => {
    entry.buffer = growOutputTail(entry.buffer, data, limit);
    // Nobody to send to — a session whose browser has closed, still working in the background.
    // Queueing would only build batches to throw away, and the buffer above is already the
    // record: a reattach replays it (and discards the queue for exactly that reason).
    if (!entry.ws) {
      queryScanTail = "";
      return;
    }
    pending.push(data);
    pendingChars += data.length;
    let hasQuery = false;
    // Plain output is the hot path under a flood. Avoid concatenating and scanning it unless an
    // ESC starts a possible query, or the preceding chunk ended after one.
    if (queryScanTail || data.includes(ESC)) {
      const queryScan = queryScanTail + data;
      hasQuery = containsTerminalQuery(queryScan);
      queryScanTail = terminalQueryPrefixTail(queryScan, QUERY_SCAN_TAIL_CHARS);
    }
    // A terminal query is invisible output whose answer comes back through xterm's onData as
    // PTY input. Do not add the normal output-batching delay to that round trip: Claude can move
    // from rendering its final frame into Stop hooks during the 8 ms window, at which point the
    // late ESC-prefixed terminal reply is liable to be read as a user interrupt (#1625).
    if (hasQuery) return flush();
    if (pendingChars >= MAX_BATCH_CHARS) return flush();
    if (timer) return;
    // Nothing went out recently, so this is a keystroke echo or a fresh prompt rather than a
    // flood — send it at once. Batching only starts once output is arriving faster than a frame.
    const sinceLastMs = Date.now() - lastSentMs;
    if (sinceLastMs >= FLUSH_INTERVAL_MS) return flush();
    timer = setTimeout(flush, FLUSH_INTERVAL_MS - sinceLastMs);
  };

  return { push, flush, discard };
}

/** Point a buffered pty's onData at a relay kept on the entry (where a reattach can reach it), and
 *  hand the relay back so the exit path can flush what is still queued.
 *
 *  `tap` is the spawner's own view of the stream — claude's draft-ready scanner, codex's
 *  seed injector — fed here rather than through a second onData listener. */
export function wireBufferedOutput(entry: PtyEntry, limit: number, tap?: (data: string) => void): OutputRelay {
  const relay = createOutputRelay(entry, limit);
  entry.output = relay;
  entry.term.onData((data) => {
    relay.push(data);
    tap?.(data);
  });
  return relay;
}
