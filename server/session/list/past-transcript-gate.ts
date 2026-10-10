// Which past session a phone may read a page of (#2999), with the stores injected so the rule can be
// pinned without them. The list is the containment: codex locates a rollout by id alone, so without
// it any codex conversation on this machine would be readable through any open session.
import type { TranscriptPage } from "../../../common/transcriptView.js";
import type { TerminalAgent } from "../../../common/sessionAgent.js";
import { findPastSession, type PastSessionRow } from "./past-session-rows.js";

export interface PastTranscriptStores {
  listPastSessions: (cwd: string) => Promise<PastSessionRow[]>;
  readPage: (cwd: string, id: string, before: string | null, agent: TerminalAgent) => Promise<TranscriptPage>;
  /** Whether `before` has the shape of a cursor this host mints. */
  isCursor: (before: string) => boolean;
}

const NOT_SUPPORTED_PAGE: TranscriptPage = { view: { status: "not-supported" }, older: null };

export async function gatedPastTranscriptPage(
  stores: PastTranscriptStores,
  cwd: string,
  pastSessionId: string,
  before: string | null,
): Promise<TranscriptPage> {
  if (before !== null && !stores.isCursor(before)) throw new Error("That page cursor is not one this host can read.");
  const row = findPastSession(await stores.listPastSessions(cwd), pastSessionId);
  if (row === null) throw new Error("That session is not among this directory's past sessions.");
  if (!row.readable) return NOT_SUPPORTED_PAGE;
  return stores.readPage(cwd, row.id, before, row.agent);
}
