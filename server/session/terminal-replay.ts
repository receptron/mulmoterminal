// Terminal "query" control sequences an application writes to probe the emulator — Device
// Attributes, device/cursor status, OSC color, kitty-keyboard flags, XTVERSION. The emulator
// auto-REPLIES to each. That's correct live, but when we replay a reattached session's buffered
// output, xterm re-answers the queries baked into it and the stale replies are sent back as
// INPUT, surfacing as junk like "0;276;0c" in the app's prompt (codex writes several at startup).
// Strip them from the replay only: they render nothing, so the visual restore is unchanged, and
// the app re-queries live if it still needs to. The same definitions also identify queries in the
// live output path, where they bypass frame batching so the emulator can answer promptly.
//
// Built via new RegExp so the ESC/BEL control chars stay out of the regex source (satisfies
// no-control-regex without a disable).
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_QUERY_CODES = ["10", "11", "12"] as const;
const OSC_QUERY_TERMINATORS = [BEL, `${ESC}\\`] as const;
const OSC_QUERY_SEQUENCES = OSC_QUERY_CODES.flatMap((code) => OSC_QUERY_TERMINATORS.map((terminator) => `${ESC}]${code};?${terminator}`));

const QUERY_SOURCES: string[] = [
  ESC + "\\[[>=]?\\d*c", // Device Attributes (DA1/DA2/DA3) — the "…c" symptom
  ESC + "\\[(?:[56]|\\?\\d+)n", // standard or DEC-private device / cursor status query
  ESC + "\\[\\?u", // kitty keyboard flags query
  ESC + "\\[>\\d*q", // XTVERSION
  ESC + "\\](?:" + OSC_QUERY_CODES.join("|") + ");\\?(?:" + BEL + "|" + ESC + "\\\\)", // OSC fg/bg/cursor color query
];
const QUERY_PATTERNS = QUERY_SOURCES.map((source) => new RegExp(source, "g"));
const ANY_QUERY_PATTERN = new RegExp(QUERY_SOURCES.map((source) => `(?:${source})`).join("|"));

/** Whether a live output fragment contains a terminal query that the browser will answer through
 *  the PTY input channel. A caller may include a short tail from the preceding fragment so a
 *  sequence split across node-pty reads is still recognised. */
export function containsTerminalQuery(data: string): boolean {
  return ANY_QUERY_PATTERN.test(data);
}

/** Return a trailing fragment that can still become a recognised terminal query. Completed or
 *  unrelated escape sequences return an empty string, keeping ordinary live output off the scan
 *  path after its next chunk. */
export function terminalQueryPrefixTail(data: string, limit: number): string {
  let candidate = "";
  for (let escapeAt = data.lastIndexOf(ESC); escapeAt >= 0;) {
    const suffix = data.slice(escapeAt);
    if (suffix.length > limit) break;
    if (suffix === ESC || OSC_QUERY_SEQUENCES.some((query) => query.length > suffix.length && query.startsWith(suffix))) {
      candidate = suffix;
    } else if (suffix.startsWith(`${ESC}[`)) {
      const parameters = suffix.slice(2);
      // DA and XTVERSION accept an optional marker followed by digits; private DSR and kitty share
      // the '?' prefix. A final c/n/q/u makes the sequence complete and therefore fails these tests.
      if (/^[>=]?\d*$/.test(parameters) || /^\?\d*$/.test(parameters)) candidate = suffix;
    }
    if (escapeAt === 0) break;
    escapeAt = data.lastIndexOf(ESC, escapeAt - 1);
  }
  return candidate;
}

export function stripTerminalQueries(data: string): string {
  return QUERY_PATTERNS.reduce((out, re) => out.replace(re, ""), data);
}

// The DECSETs that put a reattaching browser back into the screen buffer and mouse modes the app
// set once and never repeated (#1073) — read from tmux, sent AHEAD of the replay so the tail
// renders where it was written.
//
// ONE SEQUENCE PER MODE, never `CSI ? 1049 ; 1003 h`. The client only swallows a sequence whose
// parameters are ALL mouse modes (src/composables/mouseTrackingModes.ts); a combined one would
// reach xterm, which would then do the mouse tracking itself and turn every drag into coordinate
// reports instead of a text selection — the regression #729 exists to prevent.
//
// Order within the prefix doesn't matter (the client records modes into a Set, and xterm's mouse
// state survives the buffer switch). Preceding the replay is what matters.
export function terminalModePrefix(modes: readonly number[]): string {
  return modes.map((mode) => `${ESC}[?${mode}h`).join("");
}

// A CSI sequence closes with a final byte in 0x40-0x7E; an OSC string closes with BEL
// or ST. Neither can appear inside the sequence before its terminator, so the first
// occurrence IS the end.
const CSI_FINAL = /[\x40-\x7E]/;
// ST is the TWO bytes `ESC \`, so the backslash must be consumed with the escape or it
// leaks into the retained output. The trailing `?` still matches a lone ESC, which is
// how a terminal aborts an unfinished OSC.
const OSC_TERMINATOR = new RegExp(BEL + "|" + ESC + "\\\\?");

// Past the END of the terminator, not past its first character — ST is two bytes wide.
const firstMatchEnd = (text: string, terminator: RegExp): number => {
  const found = terminator.exec(text);
  if (!found) return text.length;
  return found.index + found[0].length;
};

// How many leading characters of `cut` belong to a sequence the truncation split. Zero
// when the cut fell cleanly BETWEEN sequences — the common case, and the one where every
// byte must be kept.
//
// This is decided from the discarded side, not guessed from the retained side. An earlier
// version pattern-matched the head of `cut` and could strip ordinary text
// ("/api/v1/resource" -> "pi/v1/resource"); knowing what was thrown away removes the
// guesswork entirely.
//
// The search for the opening escape spans the WHOLE discarded prefix rather than a fixed
// window. A bounded look-behind misses OSC strings whose payload is longer than the
// window — and this host enables OSC 52 deliberately (see infra/tmux.ts), so kilobyte
// base64 clipboard payloads are a designed-for case, not a hypothetical.
const splitSequenceLength = (combined: string, cutAt: number, cut: string): number => {
  const escapeAt = combined.lastIndexOf(ESC, cutAt - 1);
  if (escapeAt === -1) return 0;
  const afterEscape = combined.slice(escapeAt + 1, cutAt);
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
  const cutAt = combined.length - limit;
  const cut = combined.slice(cutAt);
  return cut.slice(splitSequenceLength(combined, cutAt, cut));
}

// How far past `limit` the retained tail is allowed to run before it is cut back.
//
// The slack is what makes the append cheap, and its size is a memory trade, not a speed one.
// Every value tested appends in ~0.0002 ms; what changes is how much unflattened rope the tail
// carries between cuts, and a rope of small chunks costs several times its character count in
// cons nodes and per-string headers. Measured per session at a 1 MiB limit, 40-byte pty chunks:
// 1.00 MB as it was, 2.54 MB at 1.25, 6.45 MB at 2.
const TAIL_SLACK = 1.25;

// Append pty output for replay WITHOUT paying for the bound on every chunk.
//
// appendBoundedOutput slices, which flattens, so calling it per chunk costs O(limit) however
// few bytes arrived — 0.1 ms against a full 1 MiB buffer, ~11k times a second under a flooding
// command. That is one core, and it is spent starving the pty read that would have drained the
// child: six cells running the same command took 8230 ms instead of 2159 ms (#1506).
//
// Concatenation is what V8 keeps as a rope, so this is O(chunk); the exact cut happens once per
// TAIL_SLACK-worth of appended output. Readers therefore get MORE than `limit` and must cut it
// back themselves — see PtyEntry.buffer.
export function growOutputTail(buffer: string, data: string, limit: number): string {
  const grown = buffer + data;
  return grown.length > limit * TAIL_SLACK ? appendBoundedOutput(grown, "", limit) : grown;
}

/** The exact bounded tail, for the two places that read a session's buffer out. Named rather
 *  than inlined so "the buffer overruns its limit" has one answer instead of two. */
export function boundedTail(buffer: string, limit: number): string {
  return appendBoundedOutput(buffer, "", limit);
}
