import { isRecord } from "./isRecord.js";

// The pub/sub channel carrying "a terminal process was just registered for this session" — a fresh
// spawn, or a tmux session re-attached after a server restart. The GitHub board listens so a
// terminal opened anywhere shows on its card without waiting for the next read (#3363).
//
// A channel of its own rather than the `sessions` row: every consumer of that channel reads a row
// as attention state (the sound, the favicon, the cell's status), so a row that only says "opened"
// would be taken as idle and could even end a turn that was working before a restart. And a quiet
// shell never moves a flag, so the row is never published for it at all.
export const PTY_OPENED_CHANNEL = "pty-opened";

export interface PtyOpenedEvent {
  sessionId: string;
  cwd: string;
}

export const isPtyOpenedEvent = (data: unknown): data is PtyOpenedEvent => isRecord(data) && typeof data.sessionId === "string" && typeof data.cwd === "string";
