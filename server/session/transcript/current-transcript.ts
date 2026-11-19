// Pure decision for which transcript holds a session's CURRENT conversation.
//
// A `/clear` or an in-session `/resume` moves claude off `${id}.jsonl` while hooks keep arriving
// under our id, and the cleared mark records where it went (cleared-transcripts.ts). Every reader
// that shows "this cell's conversation" asks here, so none of them can show the frozen file, and
// none of them can disagree with the restart about which conversation the cell is in.

export interface MarkFacts {
  cleared: boolean;
  /** The id the mark recorded claude moving to, if any. */
  successor: string | undefined;
}

/** The transcript id to read, or null when the session has moved and there is nothing to read. */
export function currentTranscriptId(id: string, { cleared, successor }: MarkFacts): string | null {
  if (!cleared) return id;
  return successor || null;
}
