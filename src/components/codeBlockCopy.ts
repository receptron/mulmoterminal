// What "copy the last code block" should do with a fetched turn (#865). Pure, so the states a
// user can land in are pinned by tests rather than only reachable by clicking.
//
// Three of the four outcomes are NOT errors, and telling them apart is the whole point: "that
// reply had no code", "this session is too big to read", and "there is no completed turn yet"
// each need a different sentence. Collapsing them into one failure message is what makes a
// button feel broken.
import { lastFencedBlock } from "../../common/codeBlocks";
import type { FetchedTurn } from "../composables/useHandoff";

export type CopyOutcome = { kind: "ok"; text: string; lang: string | null } | { kind: "no-code" } | { kind: "too-large" } | { kind: "no-turn" };

/** `tooLarge` is the server refusing to read an oversized transcript; it rides on the same
 *  response as the turn, so it is checked before the (necessarily empty) reply. */
export function copyOutcomeFor(turn: { reply: string | null; tooLarge?: boolean | undefined }): CopyOutcome {
  if (turn.tooLarge) return { kind: "too-large" };
  if (!turn.reply) return { kind: "no-turn" };
  const block = lastFencedBlock(turn.reply);
  return block ? { kind: "ok", text: block.body, lang: block.lang } : { kind: "no-code" };
}

/** One short line for the button's transient label. Deliberately says what happened rather than
 *  "failed", because none of these is a fault the user can act on by retrying. */
export function copyOutcomeMessage(outcome: CopyOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return "Copied";
    case "no-code":
      return "No code block in the last reply";
    case "too-large":
      return "This session's transcript is too large to read";
    case "no-turn":
      return "No completed turn yet";
  }
}

/** The Clipboard API exists only in a secure context — over `http://<lan-ip>:PORT`, which is how
 *  the phone and a second machine reach this app, `navigator.clipboard` is undefined. Pasting
 *  into another app is exactly what those users are here for, so the caller shows the text for
 *  manual selection instead of reporting a failure. */
export const clipboardAvailable = (): boolean => typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;

/** True when `turn` is the shape fetchLastTurn returns. Kept next to the outcome logic so the
 *  component never has to widen a type to call it. */
export const turnOf = (fetched: FetchedTurn & { tooLarge?: boolean | undefined }): { reply: string | null; tooLarge?: boolean | undefined } => ({
  reply: fetched.reply,
  tooLarge: fetched.tooLarge,
});
