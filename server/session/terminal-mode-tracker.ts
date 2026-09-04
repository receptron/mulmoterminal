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

      // Need at least ESC [ ? to continue — carry forward if the chunk ends here.
      if (escIdx + 2 >= input.length) {
        this.partial = input.slice(escIdx);
        return;
      }

      if (input[escIdx + 1] !== "[" || input[escIdx + 2] !== "?") {
        i = escIdx + 1;
        continue;
      }

      // ESC [ ? found — read digits and semicolons until the final byte.
      let j = escIdx + 3;
      while (j < input.length && ((input.charCodeAt(j) >= 0x30 && input.charCodeAt(j) <= 0x39) || input[j] === ";")) {
        j++;
      }

      if (j >= input.length) {
        // The sequence is split: params started but no final byte yet.
        this.partial = input.slice(escIdx);
        return;
      }

      const finalByte = input[j];
      if (finalByte === "h" || finalByte === "l") {
        const params = input.slice(escIdx + 3, j);
        if (params.length > 0) {
          for (const token of params.split(";")) {
            const mode = Number(token);
            if (TRACKED_MODES.has(mode)) {
              if (finalByte === "h") this.active.add(mode);
              else this.active.delete(mode);
            }
          }
        }
      }

      i = j + 1;
    }
  }

  /** The modes currently on, in the same shape terminalModesOf returns. */
  modes(): readonly number[] {
    return [...this.active];
  }
}
