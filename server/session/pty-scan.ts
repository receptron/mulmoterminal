// Reading markers OUT of a pty stream — the opposite direction from pty-text.ts, which
// sanitizes text we type INTO one. Used by the draft-injection scanner to recognize
// claude's "input box is ready" hint and its trust dialog.
//
// The stream is not the screen. A TUI redraws by positioning the cursor between words, so
// the bytes carrying "? for shortcuts" arrive as
//
//   ?ESC[24GforESC[28Gshortcuts
//
// and a plain-text regex over raw pty data never matches. That is how the draft readiness
// marker became dead code: every claude spawn fell through to the 6-second quiet fallback,
// which is why a chat started from the collection UI sat ~10s before its prompt appeared.
// The trust-dialog guard was matched the same way and had the same hole.
//
// So markers are matched against a SQUASHED form: escape sequences, control bytes and ALL
// whitespace removed, lowercased. Dropping whitespace rather than replacing each escape
// with a space is what makes it hold in both directions — an escape between two words and
// one that lands inside a word squash identically — and marker strings are distinctive
// enough that losing the spaces cannot make one match something else.
//
// Markers written for this function therefore carry no spaces: /\?forshortcuts/, not
// /\? for shortcuts/.

const ESC = "\u001b";
const BEL = "\u0007";

// The three escape shapes screen-rows.ts splits on, with the full CSI parameter range
// rather than just digits (a stream carries ESC[?2004h and ESC[>4;2m, a capture does not):
//
//   ESC ] <text> (BEL | ESC \)  |  ESC [ <params> <intermediates> <final>  |  ESC <byte>
//
// Composed from the control bytes rather than written as one literal, for the same reason
// as there: a regex literal carrying them is what the control-character lint rules forbid.
const ESCAPES = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[@-_]`, "gu");

// Whatever control bytes survive escape removal (a stray BEL, a sequence split across two
// reads). Not text, and never part of a marker.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES = /[\u0000-\u001F\u007F-\u009F]/gu;

/** A pty read reduced to the form markers are matched against: no escapes, no control
 *  bytes, no whitespace, lowercase. */
export const squashForMarker = (data: string): string => data.replace(ESCAPES, "").replace(CONTROL_BYTES, "").replace(/\s+/gu, "").toLowerCase();
