// A seam for opening a new grid terminal cell from anywhere — the header "new terminal" button
// (open.terminal). The new cell runs the OS default shell ($SHELL) in `cwd`. GridView owns the grid
// state, so it REGISTERS a handler here; the button just calls openTerminalAt(). The new cell opens
// next to the cell identified by `afterSlotKey` (the durable slot key "cell-<uid>"), or at the end when
// that can't be resolved (e.g. the single view, whose slot key isn't a grid cell).

export interface NewTerminalRequest {
  cwd: string;
  afterSlotKey: string | null;
}
type Handler = (req: NewTerminalRequest) => void;

let handler: Handler | null = null;

// GridView registers its opener; the returned function unregisters it (call in onBeforeUnmount).
export function registerNewTerminalHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

// Open a new terminal cell running $SHELL in `cwd`, next to `afterSlotKey`'s cell.
export function openTerminalAt(cwd: string, afterSlotKey: string | null): void {
  handler?.({ cwd, afterSlotKey });
}
