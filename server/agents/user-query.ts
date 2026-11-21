// The `<user_query>` wrapper two CLIs store a prompt in: cursor's transcript and grok's
// chat_history.jsonl. Shared so the two cannot disagree about where a prompt ends.

const OPEN_TAG = "<user_query>";
const CLOSE_TAG = "</user_query>";

/** What the USER said, with the wrapper removed — cursor also prepends a `<timestamp>` block, and
 *  neither belongs in a quote of what was asked.
 *
 *  FIRST OPEN TO **LAST** CLOSE, and that is the whole of why this is index arithmetic rather than a
 *  regex. Neither CLI escapes the marker: a prompt containing the literal text `</user_query>` is
 *  stored verbatim inside the wrapper (measured in both — asked in one, read back from the log). A
 *  non-greedy capture stops at the first close and truncates the prompt there, which is exactly the
 *  text a user is most likely to type while asking about this format. The last close is the wrapper's
 *  own, because the CLI appends it after the prompt.
 *
 *  Unwrapped only when both markers are present and in that order; anything else is returned as it
 *  came, which is what a record from some other writer should get. */
export function userQueryText(text: string): string {
  const open = text.indexOf(OPEN_TAG);
  const close = text.lastIndexOf(CLOSE_TAG);
  if (open === -1 || close <= open) return text.trim();
  return text.slice(open + OPEN_TAG.length, close).trim();
}
