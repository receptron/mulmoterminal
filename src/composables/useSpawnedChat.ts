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
// drains the queue when it registers on activate. Same contract as useNewTerminal, down to the
// shared createHandlerQueue: a collection action can spawn more than one chat before the route
// changes, and a dropped one is a live agent with nowhere to appear.
import { router } from "../router";
import { createHandlerQueue } from "./handlerQueue";
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
  /** A collection card is ALREADY waiting in this session's Canvas, so the cell should arrive
   *  enlarged with the pane open — otherwise the card sits behind two gestures nobody knows to
   *  make.
   *
   *  OPT-IN, not a field every caller answers: revealing is right only when something is already
   *  in the pane, and taking over the screen to show an EMPTY one is worse than leaving the grid
   *  as the user arranged it. A spawn with no canvas to show (an issue being started, a skill
   *  button, cron) says nothing here and gets the grid's ordinary behaviour. */
  canvas?: boolean;
}
/** Returns whether the grid actually took it. `false` means the grid was FULL and fell back to
 *  showing the session in the single view — the one case where bringing the grid on screen would
 *  take the user away from where the session just appeared. */
type Handler = (req: SpawnedChatRequest) => boolean;

const queue = createHandlerQueue<SpawnedChatRequest, boolean>();

// GridView registers its placer; every request queued before it activated drains immediately, in
// arrival order. The returned function unregisters it (call in onDeactivated / onBeforeUnmount).
export function registerSpawnedChatHandler(h: Handler): () => void {
  return queue.register(h);
}

/** Options for where the user should be left afterwards. */
export interface PlaceOptions {
  /** Bring the grid on screen. False for a chat started from a collection: it becomes a cell like
   *  any other, but the reader stays with the collection and sees it in the pane there (#2001). */
  reveal?: boolean;
}

/** Show a spawned chat as a grid cell. If the grid isn't mounted yet, queue it and switch to it.
 *
 *  Returns whether the grid took it — false means it was FULL, so the session is waiting with no
 *  cell, which a caller that was going to show it somewhere has to know. */
export function placeSpawnedChat(req: SpawnedChatRequest, opts: PlaceOptions = {}): boolean {
  // `true` for a queued request too: the grid will have it as soon as it registers, so the grid is
  // still where the user should be looking.
  const goingToTheGrid = queue.deliver(req, true);
  // Then SHOW the grid. Mounted is not the same as on screen: since #1190 the grid stays alive
  // UNDERNEATH a full-screen overlay, so a chat started from the collections browser is placed
  // into a grid the user cannot see. Navigating is also what closes that overlay — before the grid
  // survived one, the queue-and-navigate path did this by accident, and it stopped happening the
  // moment the grid stopped unmounting.
  //
  // NOT when the grid refused it. A full grid falls back to the single view, and pushing here
  // would drag the user off the view the session was just shown in (Codex, PR #1193).
  if (!goingToTheGrid) return false;
  if (opts.reveal !== false && router.currentRoute.value.name !== "terminals") router.push({ name: "terminals" }).catch(() => {});
  return true;
}

/** Test seam: drop anything queued by a previous case. Not used by the app. */
export function resetSpawnedChatQueue(): void {
  queue.reset();
}
