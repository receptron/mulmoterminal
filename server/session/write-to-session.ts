import { deferDuringBotDelivery, noteBotUserInput, noteBotPointerInput, forgetBotInput } from "../bots/input-gate.js";
import { ptys } from "./registry.js";
import { scanForUserInput, scanForDraftInput } from "../../common/terminalReplies.js";

// Write a chunk to a session's live PTY: the phone's typing (#445), and question answers (#1685).
// Only sessions attached in THIS process are writable: a tmux session that outlived a restart is
// still viewable through capture-pane, but we hold no pty to type into.
//
// Its own module rather than a helper in index.ts, because it now has two callers that reach it
// from different directions — the RemoteHost handlers and an /api route — and index.ts is the file
// this repo keeps splitting apart (#548).
const write = (sessionId: string, chunk: string): boolean => {
  const entry = ptys.get(sessionId);
  if (!entry) return false;
  try {
    entry.term.write(chunk);
    return true;
  } catch {
    // pty died between the lookup and the write
    return false;
  }
};

// How many times something OTHER than an in-flight answer has typed into this session.
//
// Answering a question takes ~300ms of paced keystrokes (#1685), and the person at the keyboard can
// answer or cancel that same dialog inside one of those pauses. The remaining Down/Enter would then
// reach the prompt underneath and walk its history. No snapshot of the dialog can see that coming:
// the tool-call close arrives asynchronously, well after the screen changed.
//
// So every ordinary writer announces itself, and the count runs from the moment the DIALOG appeared
// — not from when an answer request arrives. Anything typed in between is exactly what makes the
// dialog no longer the one our keystrokes were computed for, whether it answered it, cancelled it,
// or merely moved its cursor; and a count that started at the request could not see it.
//
// A counter rather than a lock, because an answer must not BLOCK the user's own typing — it is the
// answer that yields.
//
// One entry per session with a live question, reset when the next one opens and dropped when the
// session is reaped.
const watched = new Map<string, number>();

/** Start (or restart) counting for this session's newly opened dialog. */
export const watchOtherWrites = (sessionId: string): void => {
  watched.set(sessionId, 0);
};

/** Stop counting, and forget the session. */
export const stopWatchingOtherWrites = (sessionId: string): void => {
  watched.delete(sessionId);
  partialReply.delete(sessionId);
};

export const otherWriteCount = (sessionId: string): number => watched.get(sessionId) ?? 0;

/** Say that something other than an answer has typed here — for a writer that holds its own pty.
 *  The browser's keystroke path does its own write (it already has the entry, and going through a
 *  registry lookup on every keypress would drop input in any window where the two disagree).
 *  A no-op unless an answer is listening, which is the ordinary case. */
export const noteOtherWrite = (sessionId: string): void => {
  const seen = watched.get(sessionId);
  if (seen !== undefined) watched.set(sessionId, seen + 1);
};

// The tail of a reply that arrived split across frames, per session. The socket breaks where it
// likes, and half of `ESC[?1;2c` matches nothing — judged on its own, each half would read as the
// user typing, which is the false alarm this whole path exists to avoid (#1693).
const partialReply = new Map<string, string>();

// WHEN THE PERSON AT THE KEYBOARD LAST TYPED, per session.
//
// Separate from the counter above because it answers a different question. The counter asks "has
// anything happened since this dialog opened" and is armed only while an answer is in flight; this
// asks "is somebody typing RIGHT NOW", and it has to be answerable at any moment, for any session.
//
// What needs it is unsolicited text — a shared-app watch firing (server/session/shared-app-watches.ts).
// An agent's input box holds whatever the user has typed until they submit, so a paste lands after
// their draft and the two are submitted merged (#572). The phone's own typing empties the box first,
// which it may do because the user asked for that send; nothing the user did not ask for may throw
// their draft away. Waiting for quiet is what is left.
//
// It sees the BROWSER's keystrokes, which is where they come from for a session in the grid. A user
// typing into a tmux attach in another window is invisible here, and this makes no claim about them.
const lastUserInputAt = new Map<string, number>();

/** Milliseconds since the user last typed here, or Infinity if they never have in this process. */
export const msSinceUserInput = (sessionId: string, now = Date.now()): number => {
  const at = lastUserInputAt.get(sessionId);
  return at === undefined ? Number.POSITIVE_INFINITY : now - at;
};

/** Classify one chunk of terminal input and count it if the user produced it. */
export const noteInput = (sessionId: string, data: string): void => {
  const previous = partialReply.get(sessionId) ?? "";
  const { fromUser, pending } = scanForUserInput(previous, data);
  if (pending) partialReply.set(sessionId, pending);
  else partialReply.delete(sessionId);
  if (fromUser) {
    // Mouse input still interrupts question answers and resets the activity clock.
    // Only tmux frontends can verify the resulting screen before a Bot notification.
    if (!ptys.get(sessionId)?.tmux || scanForDraftInput(previous, data).fromUser) noteBotUserInput(sessionId);
    else noteBotPointerInput(sessionId);
    lastUserInputAt.set(sessionId, Date.now());
    noteOtherWrite(sessionId);
  }
};

/** Teardown for a session that has ended. */
export const forgetUserInputClock = (sessionId: string): void => {
  lastUserInputAt.delete(sessionId);
  forgetBotInput(sessionId);
};

/** Write on behalf of anything but an answer: the phone's typing, and anything added later. */
export const writeToSession = (sessionId: string, chunk: string): boolean => {
  if (
    deferDuringBotDelivery(sessionId, () => {
      writeToSession(sessionId, chunk);
    })
  )
    return true;
  noteBotUserInput(sessionId);
  noteOtherWrite(sessionId);
  return write(sessionId, chunk);
};

/** The keystrokes an answer types. Deliberately NOT counted — it must not interrupt itself. */
export const writeAnswerKey = (sessionId: string, chunk: string): boolean => write(sessionId, chunk);
