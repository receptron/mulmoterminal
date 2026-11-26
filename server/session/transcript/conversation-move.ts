// Pure decision for what a SessionStart does to the session's cleared mark.
//
// Two commands move claude off the transcript filed under our id while hooks keep arriving under
// it: `/clear` (a new id and a new file) and an in-session `/resume` (the id of the conversation
// picked). Both leave our file frozen on a conversation the cell no longer shows, and the mark's
// `claudeId` is where the conversation went — the one a restart resumes (#3325).
//
// A `--resume` that WE issue announces itself as `resume` too, under the id it was handed, which
// is why the recorded successor is excluded: re-marking it on every restart would blank the
// header each time. `/compact` keeps both the id and the file (measured on Claude Code 2.1.292).
//
// ← (move to the background) is the third: claude goes on with the SAME conversation in a forked
// process under a new id, announced as `fork` (Claude Code 2.1.332). It is `follow`, not `mark`,
// because nothing ended there — the prompts before it still belong to the conversation (#3538).

export type ConversationMove = "mark" | "follow" | "unmark" | "none";

export interface ConversationMoveInput {
  /** The SessionStart payload's `source`, unchecked. */
  source: unknown;
  /** Our id for the session — the `x-mt-session` the hook arrived under. */
  sessionId: string;
  /** The id claude named for itself in this hook, already shape-checked; null when it named none. */
  claudeId: string | null;
  /** The successor the current mark recorded, if any. */
  recordedSuccessor: string | undefined;
  /** Whether the session is marked right now. */
  marked: boolean;
}

function resumeMove({ sessionId, claudeId, recordedSuccessor, marked }: ConversationMoveInput): ConversationMove {
  if (!claudeId) return "none";
  // Back on our own transcript: claude appends to it again, so it is no longer frozen.
  if (claudeId === sessionId) return marked ? "unmark" : "none";
  if (claudeId === recordedSuccessor) return "none";
  return "mark";
}

function forkMove({ sessionId, claudeId, recordedSuccessor }: ConversationMoveInput): ConversationMove {
  if (!claudeId || claudeId === sessionId || claudeId === recordedSuccessor) return "none";
  return "follow";
}

export function conversationMove(input: ConversationMoveInput): ConversationMove {
  if (input.source === "clear") return "mark";
  if (input.source === "resume") return resumeMove(input);
  if (input.source === "fork") return forkMove(input);
  return "none";
}
