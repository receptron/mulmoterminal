// Only the most recent request's answer is used. A poll started before a person's action can
// return after it, and a preview for a pair the user already switched away from can return after
// the one they switched back to; either would put an older state on screen.
export interface LatestOnly {
  /** A ticket for a request about to be sent; taking one outdates every earlier ticket. */
  take: () => number;
  isLatest: (ticket: number) => boolean;
}

export function latestOnly(): LatestOnly {
  let newest = 0;
  return {
    take: () => ++newest,
    isLatest: (ticket) => ticket === newest,
  };
}
