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

// A CSI sequence closes with a final byte in 0x40-0x7E; an OSC string closes with BEL
// or ST. Neither can appear inside the sequence before its terminator, so the first
// occurrence IS the end.
const CSI_FINAL = /[\x40-\x7E]/;
const OSC_TERMINATOR = new RegExp(BEL + "|" + ESC);

// Escape sequences are short, so the sequence a cut may have landed inside is always
// near the cut. Bounds the look-behind to a constant instead of the whole 64 KiB.
const SEQUENCE_LOOKBEHIND = 64;

const firstMatchEnd = (text: string, terminator: RegExp): number => {
  const found = terminator.exec(text);
  if (!found) return text.length;
  return found.index + 1;
};

// How many leading characters of `cut` belong to a sequence the truncation split, given
// the text discarded before it. Zero when the cut fell cleanly BETWEEN sequences — which
// is the common case, and where every byte must be kept.
//
// This is decided from the discarded side, not guessed from the retained side. The
// previous version pattern-matched the head of `cut` and could strip ordinary text
// ("/api/v1/resource" -> "pi/v1/resource"); knowing what was thrown away removes the
// guesswork entirely.
const splitSequenceLength = (discarded: string, cut: string): number => {
  const tail = discarded.slice(-SEQUENCE_LOOKBEHIND);
  const escapeAt = tail.lastIndexOf(ESC);
  if (escapeAt === -1) return 0;
  const afterEscape = tail.slice(escapeAt + 1);
  // The introducer went with the discarded text, or it is the first retained character.
  const introducer = afterEscape.length > 0 ? afterEscape.charAt(0) : cut.charAt(0);
  const retained = afterEscape.length > 0 ? cut : cut.slice(1);
  const consumedIntroducer = afterEscape.length > 0 ? 0 : 1;
  if (introducer === "[") {
    // Closed already if a final byte followed the introducer before the cut.
    if (CSI_FINAL.test(afterEscape.slice(1))) return 0;
    return consumedIntroducer + firstMatchEnd(retained, CSI_FINAL);
  }
  if (introducer === "]") {
    if (OSC_TERMINATOR.test(afterEscape.slice(1))) return 0;
    return consumedIntroducer + firstMatchEnd(retained, OSC_TERMINATOR);
  }
  // A two-character sequence (ESC + one byte). It is complete unless that byte is the
  // first retained character, in which case dropping it alone is enough.
  return consumedIntroducer;
};

// Append PTY output, keeping a bounded tail for reattach replay.
//
// Cutting by character count can land INSIDE an escape sequence, and the orphaned
// parameter bytes then render as literal junk ("5;196m") at the top of the screen
// restored on reattach — stripTerminalQueries can't help, it only matches whole
// sequences. So drop exactly the split sequence and nothing else.
export function appendBoundedOutput(buffer: string, data: string, limit: number): string {
  const combined = buffer + data;
  if (combined.length <= limit) return combined;
  const cut = combined.slice(-limit);
  return cut.slice(splitSequenceLength(combined.slice(0, combined.length - limit), cut));
}
