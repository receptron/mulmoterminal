// A seam for placing an ALREADY-SPAWNED chat session as a grid cell — the sibling of
// useNewTerminal, which spawns a fresh one. Everything that starts a chat programmatically goes
// through here: the collection UI's create button and its collection / record actions, the
// new-collection template cards and custom views (all via startCollectionChat), and the Settings
// skill buttons. GridView owns the grid state, so it REGISTERS a handler; callers just call
// placeSpawnedChat().
//
// Why a separate seam rather than a flag on useNewTerminal: that one carries a cwd to spawn AT,
// this one carries a session id to ADOPT. The spawn already happened — it is the only way to seed
// a first turn, since a plain claude cell has no channel to be handed a prompt — so a cell here
// attaches to a live PTY, which is the same path a reload takes to reattach.
//
// When the grid isn't mounted (the chat was started from a collection overlay, which renders in
// the single-view shell), the request is QUEUED and the app switches to /terminals; GridView
// drains the queue when it registers on activate. Same contract as useNewTerminal, including the
// queue holding EVERY waiting request: a collection action can spawn more than one chat before
// the route changes, and a dropped one is a live agent with nowhere to appear.
import { router } from "../router";
import type { TerminalAgent } from "../../common/sessionAgent";

export interface SpawnedChatRequest {
  /** The session the server already spawned. The cell attaches to it. */
  id: string;
  /** Travels WITH the id: without it the cell reconnects on Claude's endpoint, so a codex
   *  session would attach as claude. */
  agent: TerminalAgent;
  /** The prompt was typed into the input box without an Enter (spawnBackgroundChat draft:true)
   *  and is waiting for the user to review it — not a turn already running. */
  draft: boolean;
}
type Handler = (req: SpawnedChatRequest) => void;

let handler: Handler | null = null;
let pending: SpawnedChatRequest[] = [];

// GridView registers its placer; every request queued before it activated drains immediately, in
// arrival order. The returned function unregisters it (call in onDeactivated / onBeforeUnmount).
export function registerSpawnedChatHandler(h: Handler): () => void {
  handler = h;
  // Taken before dispatching, as in useNewTerminal: a handler that itself queues would otherwise
  // have its request dropped by the clear below.
  const queued = pending;
  pending = [];
  queued.forEach((req) => h(req));
  return () => {
    if (handler === h) handler = null;
  };
}

/** Show a spawned chat as a grid cell. If the grid isn't mounted yet, queue it and switch to it. */
export function placeSpawnedChat(req: SpawnedChatRequest): void {
  if (handler) {
    handler(req);
    return;
  }
  pending.push(req);
  router.push({ name: "terminals" }).catch(() => {});
}

/** Test seam: drop anything queued by a previous case. Not used by the app. */
export function resetSpawnedChatQueue(): void {
  handler = null;
  pending = [];
}
