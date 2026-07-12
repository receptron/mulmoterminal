// A seam for opening a new grid terminal cell from anywhere — the header "new terminal" button
// (open.terminal). The new cell runs the OS default shell ($SHELL) in `cwd`. GridView owns the grid
// state, so it REGISTERS a handler here; the button just calls openTerminalAt(). The new cell opens
// next to the cell identified by `afterSlotKey` (the durable slot key "cell-<uid>"), or at the end when
// that can't be resolved (e.g. the single view, whose slot key isn't a grid cell).
//
// When the grid isn't mounted (the button pressed from the single view), the request is QUEUED and the
// app switches to /terminals; GridView drains the queue when it registers on mount — mirroring
// usePendingScript for the single view's Run menu.
import { router } from "../router";

export interface NewTerminalRequest {
  cwd: string;
  afterSlotKey: string | null;
}
type Handler = (req: NewTerminalRequest) => void;

let handler: Handler | null = null;
let pending: NewTerminalRequest | null = null;

// GridView registers its opener; a queued request (from before it mounted) drains immediately.
// The returned function unregisters it (call in onBeforeUnmount).
export function registerNewTerminalHandler(h: Handler): () => void {
  handler = h;
  if (pending) {
    const req = pending;
    pending = null;
    h(req);
  }
  return () => {
    if (handler === h) handler = null;
  };
}

// Open a new terminal cell running $SHELL in `cwd`, next to `afterSlotKey`'s cell. If the grid isn't
// mounted yet, queue the request and switch to it.
export function openTerminalAt(cwd: string, afterSlotKey: string | null): void {
  const req: NewTerminalRequest = { cwd, afterSlotKey };
  if (handler) {
    handler(req);
    return;
  }
  pending = req;
  router.push("/terminals").catch(() => {});
}
