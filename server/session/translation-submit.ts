// What POST /api/translation/submit answers.
//
// The hidden translation worker reports here through the broker's worker-only
// submitTranslation tool, so the three outcomes are: an id that is not the known UUID shape
// (the value reaches a Map key and a pub/sub channel name), an id with nothing waiting on it
// — already settled, timed out, or never a worker — and the hand-off itself.
//
// The hand-off is passed in rather than imported so the decision can be tested without a
// worker in flight; it is the one thing here that is not a decision (#548).
import { isRecord } from "./transcript.js";

export type TranslationSubmitOutcome = { status: 200; body: { ok: true } } | { status: 400 | 404; body: { error: string } };

export function translationSubmitOutcome(
  requestBody: unknown,
  isValidSessionId: (id: string) => boolean,
  handOff: (sessionId: string, translations: unknown) => boolean,
): TranslationSubmitOutcome {
  const { sessionId, translations } = isRecord(requestBody) ? requestBody : {};
  if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) {
    return { status: 400, body: { error: "invalid sessionId" } };
  }
  if (!handOff(sessionId, translations)) {
    return { status: 404, body: { error: "no pending translation for this session" } };
  }
  return { status: 200, body: { ok: true } };
}
