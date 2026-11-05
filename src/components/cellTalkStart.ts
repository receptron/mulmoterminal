// Whether this cell may START a cross-talk or a round table. A kept cell whose session ended still
// holds its id (only teardown clears it) and its transcript is still readable, so without the
// `sessionEnded` half its last turn would be typed into a live cell as if it had just said it.
export interface TalkStartState {
  sessionId: string | null;
  sessionEnded: boolean;
}

export const canStartTalk = (state: TalkStartState): boolean => !!state.sessionId && !state.sessionEnded;
