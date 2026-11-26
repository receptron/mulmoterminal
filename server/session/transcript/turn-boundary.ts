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
}

export const emptyTurnBoundary = (): TurnBoundaryState => ({ openPromptId: null });

const promptIdOf = (record: Record<string, unknown>): string | null => (typeof record.promptId === "string" && record.promptId !== "" ? record.promptId : null);

/** Ask ONCE per record, and only for one that carries prompt text: it advances the state.
 *
 *  Only a META record is held to the id. A typed one always opens a turn, because the id is not
 *  unique to a typed prompt: after a resume, Claude Desktop writes its meta "Continue from where you
 *  left off." and the person's next prompt under one id. A meta record with no id opens nothing —
 *  every meta record that opens a turn (a peer message, a wakeup prompt) carries one. */
export function opensTurn(state: TurnBoundaryState, record: Record<string, unknown>): boolean {
  const promptId = promptIdOf(record);
  if (record.isMeta === true && (promptId === null || promptId === state.openPromptId)) return false;
  state.openPromptId = promptId;
  return true;
}

/** A tool result belongs to the turn that called the tool, so its id IS the open turn's. Learning it
 *  is what lets a window that begins mid-turn — a tail read, an older page — recognise the skill
 *  body that follows the Skill call's result as part of that turn. */
export function continuesTurn(state: TurnBoundaryState, record: Record<string, unknown>): void {
  const promptId = promptIdOf(record);
  if (promptId !== null) state.openPromptId = promptId;
}

export const isTurnBoundaryState = (value: unknown): value is TurnBoundaryState =>
  isRecord(value) && (value.openPromptId === null || typeof value.openPromptId === "string");
