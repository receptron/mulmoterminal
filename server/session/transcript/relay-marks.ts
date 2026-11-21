// Where each relay last ended (#3389), as one line of an append log per relay. Appended rather than
// rewritten for the memo log's reason: ~/.mulmoterminal is shared by every server on the machine,
// and two instances rewriting one snapshot lose whichever finishes first. The last line for a key
// wins.

import { isTerminalAgent, type TerminalAgent } from "../../../common/sessionAgent.js";
import { isRelayMark } from "./relay-range.js";

export interface RelayMarkKey {
  agent: TerminalAgent;
  /** The source's conversation id — a position only means something inside one conversation. */
  conversation: string;
  /** The destination directory; cells in one directory share where the relay ended. */
  dest: string;
}

export interface RelayMarkRecord extends RelayMarkKey {
  mark: string;
}

/** A path longer than any real one is a malformed line, not a directory. */
export const RELAY_DEST_MAX_CHARS = 4096;

export const isRelayDest = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= RELAY_DEST_MAX_CHARS;

export const relayMarkMapKey = (key: RelayMarkKey): string => JSON.stringify([key.agent, key.conversation, key.dest]);

/** One line of the log. `at` is for a human reading the file; nothing parses it back. */
export const relayMarkLine = (record: RelayMarkRecord, at: number): string => `${JSON.stringify({ ...record, at })}\n`;

export function relayMarkRecord(parsed: Record<string, unknown>, isValidId: (id: string) => boolean): RelayMarkRecord | null {
  const { agent, conversation, dest, mark } = parsed;
  if (typeof agent !== "string" || !isTerminalAgent(agent)) return null;
  if (typeof conversation !== "string" || !isValidId(conversation)) return null;
  if (!isRelayDest(dest) || !isRelayMark(mark)) return null;
  return { agent, conversation, dest, mark };
}

export function applyRelayMark(marks: Map<string, string>, record: RelayMarkRecord): void {
  marks.set(relayMarkMapKey(record), record.mark);
}
