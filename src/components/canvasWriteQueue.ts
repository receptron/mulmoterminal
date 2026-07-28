// One write at a time to Claude Code's MCP config.
//
// Every Canvas switch in the launcher POSTs to /api/gui-mcp-groups, which shells out to
// `claude mcp add` / `claude mcp remove`. Those read-modify-write Claude Code's own config, so
// two in flight can lose one of the two registrations — leaving a checkbox showing "on" for a
// server that was never written, which is the one state the switch must never reach.
//
// The queue is MODULE level, not per component: the file being written is Claude Code's, shared
// by every directory, so two cells saving at once race exactly as two checkboxes in one cell do.
export type CanvasWriteQueue = (write: () => Promise<void>) => Promise<void>;

export function createCanvasWriteQueue(): CanvasWriteQueue {
  let chain: Promise<void> = Promise.resolve();
  return (write) => {
    // The SAME callback for both settlements, rather than `.then(write).catch(...)`: a rejected
    // link must not become every later write's rejection, and a failed write must not stop the
    // next one from running. Each write reports its own failure.
    chain = chain.then(write, write);
    return chain;
  };
}

export const queueCanvasWrite: CanvasWriteQueue = createCanvasWriteQueue();
