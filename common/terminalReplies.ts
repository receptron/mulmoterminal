// What a terminal emulator sends back on the INPUT channel without anyone typing.
//
// xterm.js answers the application's own queries there: device attributes, the foreground and
// background colours, the cursor position. It also says when the terminal gained or lost focus.
// All of it arrives exactly as a keystroke does, and none of it is the user answering anything.
//
// That matters to anything asking "has the user typed since this question appeared?"
// (server/session/write-to-session.ts). Counting these replies meant an answer from the question
// pane was refused after any attach, resize or theme read — measured, not guessed: a single button
// press was preceded by `ESC[?1;2c`, `ESC[>0;276;0c` and two OSC colour replies (#1693).
//
// MOUSE reports are deliberately absent. They look the same on the wire, but a click can select an
// option in the dialog — that is the user answering, and an answer already being typed must yield
// to it exactly as it yields to a keystroke.
//
// The forms are spelled out rather than generalised — no "any OSC", no "any CSI". This list decides
// what CANNOT interrupt an answer, so a pattern wider than the replies actually queried would hand
// that exemption to input nobody has looked at.
const ESC = "\u001b";
const BEL = "\u0007";
const ST = `(?:${BEL}|${ESC}\\\\)`;

const REPLIES = [
  `${ESC}\\[[IO]`, // focus in / out
  `${ESC}\\[\\?[\\d;]*c`, // primary device attributes
  `${ESC}\\[>[\\d;]*c`, // secondary / tertiary device attributes
  `${ESC}\\[\\d+;\\d+R`, // cursor position report
  `${ESC}\\]1[0-9];rgb:[\\da-fA-F/]*${ST}`, // colour queries — foreground, background, cursor
].join("|");

const ANY_REPLY = new RegExp(REPLIES, "g");
const MOUSE_REPORT = new RegExp(`${ESC}\\[<\\d+;\\d+;\\d+[Mm]|${ESC}\\[M[\\s\\S]{3}`, "g");

// A chunk can END mid-sequence: the socket splits where it likes, so `ESC[?1` and `;2c` can arrive
// separately. Neither half matches, and both would read as "the user typed" — the very false alarm
// this module exists to stop. A tail that could still GROW into a reply is held instead of judged.
//
// It stops before the terminating letter, which is what keeps a real key out of the holding pen:
// `ESC[B` (Down) carries its `B` already and cannot be waiting for anything.
//
// A LONE Escape is never held. It is how the user cancels the dialog, and holding it would let a
// paced answer carry on typing into a question they had just dismissed — while the reply it might
// theoretically have grown into is written whole by the emulator, in one frame, every time.
const STILL_GROWING = new RegExp(`^${ESC}(?:\\[[?>]?[\\d;]*|\\][\\d;]*(?:rgb:[\\da-fA-F/]*)?)$`);

/** The longest tail worth holding. Bounded so a stream of junk cannot accumulate. */
const MAX_PENDING = 64;

export interface InputScan {
  /** Did anything in this chunk come from the user? */
  fromUser: boolean;
  /** The unfinished tail, to be carried into the next chunk. */
  pending: string;
}

/**
 * Classify one chunk of terminal input, carrying `pending` from the chunk before it.
 *
 * `fromUser` is false only when everything is a reply the emulator produced by itself. A trailing
 * sequence that is still growing is neither — it waits in `pending` until it finishes.
 */
export const scanForUserInput = (pending: string, data: string): InputScan => {
  const chunk = `${pending}${data}`;
  const rest = chunk.replace(ANY_REPLY, "");
  if (rest.length > 0 && rest.length <= MAX_PENDING && STILL_GROWING.test(rest)) return { fromUser: false, pending: rest };
  return { fromUser: rest.length > 0, pending: "" };
};

/** Mouse reports are user activity (and must cancel paced answers), but do not type
 * a draft. Only complete reports are excluded; keys, mixed text and unknown fragments
 * remain conservative. Callers must verify the idle input box before automatic input,
 * since a click can still change the CLI's UI or select a suggested prompt. */
export const scanForDraftInput = (pending: string, data: string): InputScan => scanForUserInput("", `${pending}${data}`.replace(MOUSE_REPORT, ""));
