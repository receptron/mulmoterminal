// Terminal "query" control sequences an application writes to probe the emulator — Device
// Attributes, device/cursor status, OSC color, kitty-keyboard flags, XTVERSION. The emulator
// auto-REPLIES to each. That's correct live, but when we replay a reattached session's buffered
// output, xterm re-answers the queries baked into it and the stale replies are sent back as
// INPUT, surfacing as junk like "0;276;0c" in the app's prompt (codex writes several at startup).
// Strip them from the replay only: they render nothing, so the visual restore is unchanged, and
// the app re-queries live if it still needs to.
//
// Built via new RegExp so the ESC/BEL control chars stay out of the regex source (satisfies
// no-control-regex without a disable).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const QUERY_PATTERNS: RegExp[] = [
  new RegExp(ESC + "\\[[>=]?\\d*c", "g"), // Device Attributes (DA1/DA2/DA3) — the "…c" symptom
  new RegExp(ESC + "\\[\\??\\d*n", "g"), // device / cursor status report (DSR / CPR)
  new RegExp(ESC + "\\[\\?u", "g"), // kitty keyboard flags query
  new RegExp(ESC + "\\[>\\d*q", "g"), // XTVERSION
  new RegExp(ESC + "\\]1[012];\\?(?:" + BEL + "|" + ESC + "\\\\)", "g"), // OSC 10/11/12 fg/bg/cursor color query
];

export function stripTerminalQueries(data: string): string {
  return QUERY_PATTERNS.reduce((out, re) => out.replace(re, ""), data);
}

// A CSI body is parameter/intermediate bytes (0x20-0x3F) closed by a final byte
// (0x40-0x7E). Matching that at the head identifies a sequence whose ESC was cut away.
// Heuristic — plain text CAN match ("5 f" of "5 files") — so it is the last resort
// below, reached only when the tail holds no newline and no ESC at all.
const LEADING_SEQUENCE_REMNANT = /^[\x20-\x3F]{1,16}[\x40-\x7E]/;

// Append PTY output, keeping a bounded tail for reattach replay.
//
// Cutting by character count can land INSIDE an escape sequence, and the orphaned
// parameter bytes then render as literal junk ("5;196m") at the top of the restored
// screen — stripTerminalQueries can't help, it only matches whole sequences. Resume
// from the first position provably outside a sequence: a newline (CSI/SGR never span
// one) or the start of the next sequence. Preferring those over the remnant match
// trades a few more dropped bytes for a boundary we can prove; the first line of a
// truncated tail is partial anyway, so those bytes cost nothing.
export function appendBoundedOutput(buffer: string, data: string, limit: number): string {
  const combined = buffer + data;
  if (combined.length <= limit) return combined;
  const cut = combined.slice(-limit);
  const newline = cut.indexOf("\n");
  const escape = cut.indexOf(ESC);
  if (newline !== -1 && (escape === -1 || newline < escape)) return cut.slice(newline + 1);
  if (escape !== -1) return cut.slice(escape);
  return cut.replace(LEADING_SEQUENCE_REMNANT, "");
}
