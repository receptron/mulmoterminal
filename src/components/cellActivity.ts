// How a live activity push updates what a grid cell shows, and what the header says.
//
// Two different treatments of "absent", and the difference is the whole rule:
//
//   working / waiting — absent means FALSE. A push that omits them is saying the session is
//   not doing that; defaulting to the previous value would leave a finished session pulsing.
//
//   lastPrompt / aiTitle — absent means "no news, keep what is shown", but an explicit NULL
//   means "there is none now". Collapse the two and a cleared or restarted session keeps
//   displaying the prompt and title from the conversation the user just ended.

export interface ActivityPush {
  working?: boolean;
  waiting?: boolean;
  event?: string | null;
  lastPrompt?: string | null;
  aiTitle?: string | null;
}

export interface CellActivityState {
  working: boolean;
  waiting: boolean;
  event: string | null;
  lastPrompt: string | null;
  aiTitle: string | null;
}

export function applyActivityPush(previous: CellActivityState, push: ActivityPush): CellActivityState {
  return {
    working: push.working ?? false,
    waiting: push.waiting ?? false,
    event: push.event !== undefined ? push.event : previous.event,
    lastPrompt: push.lastPrompt !== undefined ? push.lastPrompt : previous.lastPrompt,
    aiTitle: push.aiTitle !== undefined ? push.aiTitle : previous.aiTitle,
  };
}

// What the cell header shows for a session: our summary, else the last prompt, else enough
// of the id to tell two cells apart, else a session that has not reported anything yet.
// `||` rather than `??` on purpose — an empty title or prompt is nothing to show, not a value.
export function cellHeaderText(aiTitle: string | null, lastPrompt: string | null, sessionId: string | null): string {
  return aiTitle || lastPrompt || (sessionId ? sessionId.slice(0, 8) : "starting…");
}
