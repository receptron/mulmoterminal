// What the hidden translation worker is asked for, and what counts as an answer. Split
// from the worker that spawns it (#548) because both are pure and both are load-bearing:
// the prompt is the only thing making the model call submitTranslation instead of replying
// in text, and the check is the only thing standing between a short or non-string answer
// and the caller's UI.

/** The worker's instructions. The tool call is named as the ONLY delivery mechanism —
 *  a text reply is discarded by the caller, so the prompt has to close that door. */
export function buildTranslationPrompt(targetLanguage: string, sentences: readonly string[]): string {
  const expected = sentences.length;
  return (
    `You are an automated translation service. Translate each of the ${expected} English strings in ` +
    `the JSON array below into the target language (BCP-47 code: ${targetLanguage}), preserving ` +
    `placeholders like {name}, {count}, %s and any HTML tags verbatim. You MUST deliver the result by ` +
    `calling the submitTranslation tool with a "translations" array of exactly ${expected} strings in ` +
    `the same order — that tool call is the ONLY way to return the result; a text reply is discarded. ` +
    `Do not call any other tool.\n\nInput: ${JSON.stringify(sentences)}`
  );
}

/** Whether a worker's answer can be handed back: one string per input, in the same shape.
 *  A wrong count means the order no longer lines up with the inputs, so a partial answer
 *  is worse than none — the caller retries a fresh worker instead. */
export function isValidTranslationResult(translations: unknown, expected: number): translations is string[] {
  return Array.isArray(translations) && translations.length === expected && translations.every((s) => typeof s === "string");
}
