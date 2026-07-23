// Which DECSET/DECRST (`CSI ? Pm h` / `l`) sequences the terminal refuses to honour, so a drag
// stays a text selection instead of becoming mouse reports typed into the agent's prompt (#729).
//
// An app that turns mouse tracking on takes the drag away from the terminal: xterm encodes it as
// coordinate escapes and sends them to the PTY, where a TUI that doesn't consume them renders the
// bytes in its input line. Selecting text is the more common interaction in a browser terminal, so
// the modes are dropped and the wheel drives xterm's own scrollback.

// Tracking modes: which mouse events the app wants reported at all.
const TRACKING_MODES = [1000, 1001, 1002, 1003];
// Encoding modes: HOW those reports are framed (UTF-8 / SGR / urxvt / SGR-pixels). Meaningless
// without tracking, and included so a combined `CSI ? 1002 ; 1006 h` still counts as all-mouse.
const ENCODING_MODES = [1005, 1006, 1015, 1016];
const MOUSE_MODES = new Set([...TRACKING_MODES, ...ENCODING_MODES]);

// A parameter may carry sub-parameters (colon-separated); the mode is the first value.
const modeOf = (param: number | number[]): number | undefined => (Array.isArray(param) ? param[0] : param);

/** True when EVERY parameter is a mouse mode, so dropping the sequence drops nothing else.
 *  A sequence that mixes in an unrelated mode (`CSI ? 25 ; 1002 h` — cursor visibility) is let
 *  through: honouring mouse tracking is a smaller harm than swallowing the other mode's effect. */
export function swallowsMouseTracking(params: readonly (number | number[])[]): boolean {
  if (params.length === 0) return false; // `CSI ? h` sets nothing — not ours to drop
  return params.every((param) => {
    const mode = modeOf(param);
    return mode !== undefined && MOUSE_MODES.has(mode);
  });
}
