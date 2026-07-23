// Run a session spawn while it is marked hidden, and un-mark it if the spawn throws.
//
// A hidden session id is a random UUID that only this process knows; nothing else ever reaps
// it. So if we add the marker, then the spawn fails, the id would linger in the hidden set for
// the life of the process — a slow leak on every failed background/feed spawn. Add before the
// spawn (a hook that fires mid-spawn must already see it hidden), remove again on failure.
export function runWithHiddenMarker<T>(hidden: boolean, sessionId: string, markers: { add(id: string): void; delete(id: string): void }, spawn: () => T): T {
  if (hidden) markers.add(sessionId);
  try {
    return spawn();
  } catch (err) {
    if (hidden) markers.delete(sessionId);
    throw err;
  }
}
