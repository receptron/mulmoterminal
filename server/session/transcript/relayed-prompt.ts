// What of a prompt is the human's own words, when the prompt may be a handoff pasted from another
// terminal (#3397). Relaying such a prompt back would hand the other agent its own words, so only
// what was typed after the pasted block is kept.

export const HANDOFF_OPENING = "Another terminal (";
export const HANDOFF_END_LINE = "--- end ---";

/** The prompt without a pasted handoff at its start; "" when nothing but the handoff is left. A
 *  handoff with no end line (the log clipped it) is taken to run to the end of the prompt. */
export function ownWordsOf(prompt: string): string {
  if (!prompt.trimStart().startsWith(HANDOFF_OPENING)) return prompt;
  const lines = prompt.split("\n");
  const endIndex = lines.findLastIndex((line) => line.trim() === HANDOFF_END_LINE);
  if (endIndex === -1) return "";
  return lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();
}
