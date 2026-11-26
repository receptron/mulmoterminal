// Whether a Claude user record that carries prompt text OPENS a turn (#3546).
//
// Text alone does not say so: Claude Code writes a skill's body and a pasted image's note into the
// user channel mid-turn, with nothing in the text to tell them from a prompt. Nor does `isMeta`: a
// message from another session and a ScheduleWakeup prompt carry it too, and those do open a turn.
// What does say so is `promptId`, which Claude Code keeps for the whole turn and renews for the next.
import { isRecord } from "../../../common/isRecord.js";

/** The id of the turn now open, as a fold remembers it between records. */
export interface TurnBoundaryState {
  openPromptId: string | null;
  /** False only for a window that starts mid-file before anything in it has named the open turn. */
  known: boolean;
}

/** For a read from the file's first byte: no turn is open, and that is known. */
export const emptyTurnBoundary = (): TurnBoundaryState => ({ openPromptId: null, known: true });

/** For a read that starts mid-file (#3553): some turn may be open, and which is not yet known. */
export const windowTurnBoundary = (): TurnBoundaryState => ({ openPromptId: null, known: false });

/** Claude Code marks a SUBMITTED prompt with `promptSource` — typed, sdk, queued, and `system` for a
 *  peer message, a scheduled prompt or an auto-continuation. Text it writes into a turn (a skill's
 *  body, an image note, a harness nudge) never carries one. */
const isSubmitted = (record: Record<string, unknown>): boolean => typeof record.promptSource === "string" && record.promptSource !== "";

const promptIdOf = (record: Record<string, unknown>): string | null => (typeof record.promptId === "string" && record.promptId !== "" ? record.promptId : null);

/** Ask ONCE per record, and only for one that carries prompt text: it advances the state.
 *
 *  Only a META record is held to the id. A typed one always opens a turn, because the id is not
 *  unique to a typed prompt: after a resume, Claude Desktop writes its meta "Continue from where you
 *  left off." and the person's next prompt under one id. A meta record with no id opens nothing.
 *  A submitted meta record always opens one; an unsubmitted one opens only under a new id, and only
 *  once the open turn is known — a slash command's expansion is the case that needs it. */
export function opensTurn(state: TurnBoundaryState, record: Record<string, unknown>): boolean {
  const promptId = promptIdOf(record);
  if (record.isMeta === true && !isSubmitted(record)) {
    if (promptId === null) return false;
    const continuing = !state.known || promptId === state.openPromptId;
    if (continuing) {
      state.openPromptId = promptId;
      state.known = true;
      return false;
    }
  }
  state.openPromptId = promptId;
  state.known = true;
  return true;
}

/** A tool result belongs to the turn that called the tool, so its id IS the open turn's. Learning it
 *  is what lets a window that begins mid-turn — a tail read, an older page — recognise the skill
 *  body that follows the Skill call's result as part of that turn. */
export function continuesTurn(state: TurnBoundaryState, record: Record<string, unknown>): void {
  const promptId = promptIdOf(record);
  if (promptId === null) return;
  state.openPromptId = promptId;
  state.known = true;
}

/** A slash command's own record starts a turn whose text arrives in the meta expansion after it,
 *  under the same id — so it ends the unknown state without claiming the id. */
export function startsCommandTurn(state: TurnBoundaryState): void {
  state.known = true;
}

export const isTurnBoundaryState = (value: unknown): value is TurnBoundaryState =>
  isRecord(value) && (value.openPromptId === null || typeof value.openPromptId === "string") && typeof value.known === "boolean";
