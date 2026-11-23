// Typing a line the server composed into a session that is waiting for it — the end of a review round
// (#3409), or what an implementer did (#3413) — once nothing holds that session's input, and not at
// all once the reason to send it is gone, however long a dialog held it back.
import { InputBlockedError, sanitizeTerminalInput, type SendOptions } from "../backends/remoteHost/terminalInput.js";
import type { AskQuestionEvent } from "../../common/askQuestion.js";

// A dialog open in the session holds the line back; it is offered again until then.
export const DELIVERY_RETRY_MS = 5000;
export const DELIVERY_ATTEMPTS = 120;

/** What says a session's input is held by a dialog, so a line typed now would land in it. */
export interface InputHoldDeps {
  openQuestion: (sessionId: string) => Promise<AskQuestionEvent | null>;
  /** The agent reported a permission prompt it is still waiting on. Its Enter would answer it. */
  permissionPending: (sessionId: string) => boolean;
}

/** A question dialog or a permission prompt holds the session's input. Asked by every sender that
 *  types into a session on its own, before the paste and again before the Enter. */
export async function inputHeld(deps: InputHoldDeps, session: string): Promise<boolean> {
  return deps.permissionPending(session) || (await deps.openQuestion(session)) !== null;
}

export interface DeliveryDeps extends InputHoldDeps {
  /** Resolves once the Enter has gone out; rejects with InputBlockedError when `blocked` says no. */
  send: (sessionId: string, text: string, options: SendOptions) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
}

/** `label` names the sender in the log when a dialog outlasts every attempt. */
export async function deliverWhenFree(deps: DeliveryDeps, session: string, text: string, ended: () => boolean, label: string): Promise<void> {
  // Asked before the paste and again before the Enter, like every other send.
  const blocked = async (): Promise<boolean> => ended() || (await inputHeld(deps, session));
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
