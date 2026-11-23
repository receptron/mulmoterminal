// Typing a line the server composed into a session that is waiting for it — the end of a review round
// (#3409), or what an implementer did (#3413) — once nothing holds that session's input, and not at
// all once the reason to send it is gone, however long a dialog held it back.
import { InputBlockedError, sanitizeTerminalInput, type SendOptions } from "../backends/remoteHost/terminalInput.js";
import type { AskQuestionEvent } from "../../common/askQuestion.js";

// A dialog open in the session holds the line back; it is offered again until then.
export const DELIVERY_RETRY_MS = 5000;
export const DELIVERY_ATTEMPTS = 120;

export interface DeliveryDeps {
  /** Resolves once the Enter has gone out; rejects with InputBlockedError when `blocked` says no. */
  send: (sessionId: string, text: string, options: SendOptions) => Promise<unknown>;
  openQuestion: (sessionId: string) => Promise<AskQuestionEvent | null>;
  sleep: (ms: number) => Promise<void>;
}

/** `label` names the sender in the log when a dialog outlasts every attempt. */
export async function deliverWhenFree(deps: DeliveryDeps, session: string, text: string, ended: () => boolean, label: string): Promise<void> {
  // Asked before the paste and again before the Enter, like every other send.
  const blocked = async (): Promise<boolean> => ended() || (await deps.openQuestion(session)) !== null;
  for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
    if (ended()) return;
    try {
      await deps.send(session, sanitizeTerminalInput(text), { blocked });
      return;
    } catch (err) {
      // After the paste the text is already in the input box, where the user can see and submit it.
      if (!(err instanceof InputBlockedError) || err.afterPaste) return;
      await deps.sleep(DELIVERY_RETRY_MS);
    }
  }
  console.error(`[${label}] a dialog in session ${session} kept the line from being typed.`);
}
