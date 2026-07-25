// "One at a time per session, never across sessions" — the only thing the phone's two
// write paths (typing a line, pressing a key) need from each other.
//
// Both paths are multi-write: typing is a paste plus a separate Enter a beat later, and a
// key send is one write per key. Interleaved, the writes of one land INSIDE the other — a
// second paste before the first Enter submits the two merged, and an arrow between a paste
// and its Enter moves the cursor through the draft instead of a menu. So the two share ONE
// chain, and a send waits for the previous send on that session to finish.

// `chains` is a parameter only so a test can see that entries do not accumulate: a host
// runs for weeks and sees hundreds of session ids, and a leak here is invisible from the
// outside — a stale resolved link behaves exactly like no link at all.
export const createSessionChain = (chains: Map<string, Promise<void>> = new Map()) => {
  return <T>(sessionId: string, task: () => Promise<T>): Promise<T> => {
    // A failed task must not poison the chain for the next one, so the stored link
    // swallows the error; the caller still sees it through `run`.
    const previous = chains.get(sessionId) ?? Promise.resolve();
    const run = previous.then(task);
    const link = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(sessionId, link);
    // Drop the entry once it is the last one, so sessions don't accumulate forever.
    link.then(() => {
      if (chains.get(sessionId) === link) {
        chains.delete(sessionId);
      }
    });
    return run;
  };
};
