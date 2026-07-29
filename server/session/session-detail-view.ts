// What GET /api/session/:id answers, given what this process remembers and what the
// transcript says.
//
// The rule is a precedence with a sentinel, and the two halves of it live in different files:
// `/clear` writes an EMPTY STRING into the live maps (hook-routes.ts), and this is the reader
// that must let that empty string win over the transcript. `??` does; `||` does not.
//
// That is the whole reason this is a tested function. Someone tidying `?? transcriptPrompt`
// into `|| transcriptPrompt` — or changing the writer's `set(id, "")` into `delete(id)` —
// brings the pre-clear prompt and the pre-clear reply back into the cockpit. It reads as
// plausible output, so it survives review, and the user sees a session that appears to still
// be working on the task they just abandoned.
//
// A restart is the sentinel's blind spot, and `transcriptCleared` is what covers it: the maps
// holding the "" are gone while the transcript is still frozen exactly as it was, so without the
// mark the fallback hands back the ended conversation on the first fetch after a restart (#1085).

export interface LiveSessionState {
  // Present, including as "", once this process has seen the session. Absent means "this
  // process knows nothing" — only then does the transcript speak.
  lastPrompt?: string | undefined;
  lastResponse?: string | undefined;
  aiTitle?: string | undefined;
  // The user's own note. Absent means there is none — an erased memo is DELETED from the store
  // rather than kept as "", so there is no cleared-vs-unknown distinction to preserve here.
  memo?: string | undefined;
}

export interface TranscriptSessionState {
  lastPrompt: string | null;
  lastResponse: string | null;
}

export interface SessionActivity {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
}

export interface SessionDetailView {
  working: boolean;
  waiting: boolean;
  event: string | null;
  lastPrompt: string | null;
  lastResponse: string | null;
  aiTitle: string | null;
  memo: string | null;
}

// `transcriptCleared`: whether `/clear` has left this session's transcript describing the
// conversation the user ENDED (cleared-transcripts.ts). Separate from the "" sentinel because the
// two survive different things — the sentinel lives in a map this process loses on restart, while
// the mark is persisted.
export function sessionDetailView(
  live: LiveSessionState,
  transcript: TranscriptSessionState,
  activity: SessionActivity,
  transcriptCleared: boolean,
): SessionDetailView {
  // What the clear wrote, restated for a process that no longer holds it. "" and not null: an
  // empty string is a value, so it survives the roster's merge and blanks the row, where null
  // reads as "no news" and leaves the pre-clear text on screen (rosterPhase.ts).
  const fallback = transcriptCleared ? { lastPrompt: "", lastResponse: "" } : transcript;
  return {
    // An absent activity record is an idle session, not an unknown one — the cockpit renders
    // a dot either way and "unknown" has no dot to render.
    working: activity.working ?? false,
    waiting: activity.waiting ?? false,
    event: activity.event ?? null,
    lastPrompt: live.lastPrompt ?? fallback.lastPrompt,
    lastResponse: live.lastResponse ?? fallback.lastResponse,
    // Ours only — never the external on-disk ai-title.
    aiTitle: live.aiTitle ?? null,
    memo: live.memo ?? null,
  };
}
