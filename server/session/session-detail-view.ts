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

export interface LiveSessionState {
  // Present, including as "", once this process has seen the session. Absent means "this
  // process knows nothing" — only then does the transcript speak.
  lastPrompt?: string;
  lastResponse?: string;
  aiTitle?: string;
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
}

export function sessionDetailView(live: LiveSessionState, transcript: TranscriptSessionState, activity: SessionActivity): SessionDetailView {
  return {
    // An absent activity record is an idle session, not an unknown one — the cockpit renders
    // a dot either way and "unknown" has no dot to render.
    working: activity.working ?? false,
    waiting: activity.waiting ?? false,
    event: activity.event ?? null,
    lastPrompt: live.lastPrompt ?? transcript.lastPrompt,
    lastResponse: live.lastResponse ?? transcript.lastResponse,
    // Ours only — never the external on-disk ai-title.
    aiTitle: live.aiTitle ?? null,
  };
}
