// Track DECSET/DECRST terminal modes directly from the PTY byte stream.
//
// On a tmux-backed session, tmux is queried for the current modes at reattach time. On a host
// with no tmux, that query has no answer, and the reattach replays into a browser that never
// learns it should be in the alternate screen — producing the garbled-scrollback corruption
// described in #1773 / #1972.
//
// This tracker is the fallback: it scans every chunk the PTY emits for the same mode sequences
// tmux would report (DECSET `CSI ? <modes> h` and DECRST `CSI ? <modes> l`), and answers the
// same question reattachPty asks of tmux.
//
// Handles a CSI sequence split across two consecutive chunks by carrying the partial tail
// forward — the concern infra/tmux.ts avoided by querying tmux instead of the byte stream.

const ESC = "\x1b";

// The same modes tmux reports via TERMINAL_MODE_FLAGS (infra/tmux.ts). Only these are tracked;
// everything else in the stream is skipped as fast as possible.
const TRACKED_MODES = new Set([1049, 1000, 1002, 1003, 1005, 1006]);

// A real DECSET/DECRST sequence is at most `ESC[?1049;1000;1002;1003;1005;1006h` — well under
// 64 bytes. A partial candidate longer than this is malformed PTY output; retaining it would
// grow without bound and rescan on every chunk.
const MAX_PARTIAL_BYTES = 64;

const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

/** Find the end of a CSI `?` parameter run (digits and semicolons). Returns the index of the
 *  first character past the run, or -1 when the run reaches `end` (split sequence). */
function scanParams(input: string, start: number, end: number): number {
  let j = start;
  while (j < end && (isDigit(input.charCodeAt(j)) || input[j] === ";")) j++;
  return j < end ? j : -1;
}

/** Apply tracked modes from a parsed `CSI ? <params> h/l` sequence. */
function applyModes(params: string, enable: boolean, active: Set<number>): void {
  for (const token of params.split(";")) {
    const mode = Number(token);
    if (TRACKED_MODES.has(mode)) {
      if (enable) active.add(mode);
      else active.delete(mode);
    }
  }
}

export class TerminalModeTracker {
  private active = new Set<number>();
  private partial = "";

  /** Scan a chunk of PTY output and update the tracked mode set. */
  scan(data: string): void {
    const input = this.partial + data;
    this.partial = "";

    let i = 0;
    while (i < input.length) {
      const escIdx = input.indexOf(ESC, i);
      if (escIdx === -1) break;

      const after = this.handleEscape(input, escIdx);
      if (after === -1) return; // partial carried forward
      i = after;
    }
  }

  /** Dispatch a single ESC sequence starting at `escIdx`. Returns the index to resume scanning
   *  from, or -1 when a partial was retained (caller should return). */
  private handleEscape(input: string, escIdx: number): number {
    // RIS (full reset) clears every mode the terminal had set.
    if (input[escIdx + 1] === "c") {
      this.active.clear();
      return escIdx + 2;
    }

    // Need at least ESC [ ? to continue — carry forward if the chunk ends here.
    if (escIdx + 2 >= input.length) {
      this.retainPartial(input, escIdx);
      return -1;
    }

    if (input[escIdx + 1] !== "[" || input[escIdx + 2] !== "?") return escIdx + 1;

    const paramEnd = scanParams(input, escIdx + 3, input.length);
    if (paramEnd === -1) {
      this.retainPartial(input, escIdx);
      return -1;
    }

    const finalByte = input[paramEnd];
    if (finalByte === "h" || finalByte === "l") {
      const params = input.slice(escIdx + 3, paramEnd);
      if (params.length > 0) applyModes(params, finalByte === "h", this.active);
    }

    return paramEnd + 1;
  }

  /** The modes currently on, in the same shape terminalModesOf returns. */
  modes(): readonly number[] {
    return [...this.active];
  }

  /** Carry an incomplete sequence forward, bounded to prevent unbounded growth from malformed
   *  PTY output that never delivers a final byte. */
  private retainPartial(input: string, from: number): void {
    const candidate = input.slice(from);
    this.partial = candidate.length <= MAX_PARTIAL_BYTES ? candidate : "";
  }
}
