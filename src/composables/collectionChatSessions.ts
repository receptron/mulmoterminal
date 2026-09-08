import { reactive } from "vue";
import type { SpawnedChatRequest } from "./useSpawnedChat";
import { usePubSub } from "./usePubSub";
import { parseSessionActivityPayload } from "./sessionActivity";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { COLLECTION_CHATS_KEY, parseFiledChats, serializeFiledChats } from "./collectionChatStorage";
import { gridSessionIds } from "./collectionTerminalClaim";

// Which chats belong to which collection (#2001).
//
// The first version tied a session to the OVERLAY: it appeared under whatever was on screen and was
// handed to the grid when the overlay closed. Both halves were wrong in use — the pane stayed open
// after switching to another collection, and going to the grid and back left nothing to come back
// to. A chat started from a collection is ABOUT that collection, so that is what it is filed under,
// and the pane shows whatever the collection you are looking at has.
//
// A collection holds SEVERAL: asking a second thing while the first is still working is the ordinary
// case, and the earlier version paid for it by pushing the first one to the grid. They are tabs now.
//
// Module state, not the pane's: it has to outlive the overlay for a chat to still be listed when
// you come back. The TERMINAL is not here at all — a chat is an ordinary grid cell, and the pane
// shows one by having the grid teleport it (`collectionTerminalClaim.ts`). This file only answers
// "which chats belong to this collection", which is what the tab strip is.

/** One collection's chats, in the order they were started, and which of them the pane is showing. */
export interface CollectionChats {
  sessions: SpawnedChatRequest[];
  activeId: string | null;
}

const NONE: CollectionChats = { sessions: [], activeId: null };

// Restored on load, saved on every change: the chats are grid cells and outlive a reload, so the
// filing has to as well — otherwise the collection comes back empty while the same agents are
// still running in the grid (reported in use).
//
// A restored chat is not trusted to still exist. It is checked the same way every other filed chat
// is: against the sessions the SERVER still runs, and against the cells this grid holds.
const filed = reactive(readFiled());

function readFiled(): Map<string, CollectionChats> {
  try {
    return parseFiledChats(localStorage.getItem(COLLECTION_CHATS_KEY));
  } catch {
    return new Map<string, CollectionChats>(); // no storage (a spec, a locked-down browser)
  }
}

function saveFiled(): void {
  try {
    localStorage.setItem(COLLECTION_CHATS_KEY, serializeFiledChats(filed));
  } catch {
    // best-effort — a full or unavailable store must not break the pane
  }
}

export function collectionChatsFor(key: string | null): CollectionChats {
  return (key && filed.get(key)) || NONE;
}

/** File a new chat under a collection and show it. Appended rather than replacing: the one already
 *  running is still running, and taking its screen away to make room is what the tabs are for. */
export function holdCollectionChat(key: string, req: SpawnedChatRequest): void {
  listenForEndings();
  if (!filedAt.has(req.id)) filedAt.set(req.id, Date.now());
  scheduleSettleCheck();
  const held = filed.get(key) ?? { sessions: [], activeId: null };
  if (!held.sessions.some((session) => session.id === req.id)) held.sessions.push(req);
  held.activeId = req.id;
  filed.set(key, held);
  saveFiled();
}

/** Show one of the collection's chats. Ignores an id it does not hold, so a stale click cannot
 *  leave the pane pointing at nothing. */
export function activateCollectionChat(key: string, id: string): void {
  const held = filed.get(key);
  if (!held?.sessions.some((session) => session.id === id)) return;
  held.activeId = id;
  saveFiled();
}

/** Stop showing one chat here — it has gone to the grid, or it has exited.
 *
 *  The neighbour to its LEFT takes over, falling back to the new first one: closing the tab you are
 *  looking at should land you on the one you were looking at before it, not on whichever happens to
 *  be first. */
export function dropCollectionChat(key: string, id: string): void {
  const held = filed.get(key);
  if (!held) return;
  const index = held.sessions.findIndex((session) => session.id === id);
  if (index < 0) return;
  held.sessions.splice(index, 1);
  filedAt.delete(id);
  if (held.sessions.length === 0) {
    filed.delete(key);
    // Nothing left to keep honest. The listener costs a callback on every session row the app ever
    // publishes, and `holdCollectionChat` puts it back the moment there is a chat again (Codex,
    // PR #2002).
    if (filed.size === 0) stopWatchingEndings();
    saveFiled();
    return;
  }
  const next = held.sessions[index - 1] ?? held.sessions[0];
  if (held.activeId === id && next) held.activeId = next.id;
  saveFiled();
}

// A session that ends while its terminal is NOT mounted — you are on another tab, in another
// collection, or out on the grid — never fires the `exit` a mounted terminal would: `detach` clears
// the slot's handlers, and `attach` replays the session and cwd but not an end already seen (Codex,
// PR #2002). Left alone, the tab comes back pointing at a session that is over.
//
// The truth is a push, not a poll: the server publishes one `{ id, event: "closed" }` on the
// sessions channel when a PTY is reaped (`SESSIONS_CHANNEL` in server/session/lifecycle.ts), which
// is what `useGridActivity` already listens to. Deliberately NOT `/api/sessions` — that list is
// scoped to one cwd and capped at the most recent N, so a chat under a collection in another
// directory, or an older one, is missing from it while perfectly alive, and dropping on absence
// would close a live tab.
//
// It listens here rather than in the pane because the filing outlives the pane: the case above is
// mostly a session that ends while nothing of this is on screen.
let stopListening: (() => void) | null = null;
function listenForEndings(): void {
  if (stopListening) return;
  const { subscribe, onConnect } = usePubSub();
  const off = subscribe("sessions", (data) => {
    const update = parseSessionActivityPayload(data);
    if (update && "closed" in update) forgetEndedChat(update.id);
  });
  // A push that happened while the socket was down is not replayed when it comes back — pub/sub
  // restores room membership, not the events missed (Codex, PR #2002). So every connect asks the
  // server outright which of these are still running. Every connect rather than every RE-connect:
  // a chat is filed as soon as it is spawned, which can be before this socket has ever come up, and
  // an ending in THAT window is equally invisible (Codex again, iteration 3).
  const offConnect = onConnect(() => {
    retireCellless();
    void reconcileWithServer();
  });
  stopListening = () => {
    off();
    offConnect();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
  };
}

/** How long after a chat is filed before its absence from the server means anything.
 *
 *  The spawn route answers with the session id and registers the session AFTER that (the spawn is
 *  not awaited), so a chat filed a moment ago can be legitimately missing from the live list — and
 *  retiring on that would close the tab of the chat that was just started. */
const SPAWN_SETTLE_MS = 10_000;
const filedAt = new Map<string, number>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** Check once the newest chat has had time to register.
 *
 *  Subscribing does not close the window on its own: when the socket is ALREADY connected the room
 *  join is emitted and the server may publish `closed` before it processes it, so a chat that ends
 *  in those milliseconds is announced to nobody (Codex, PR #2002). Nothing else would ask again
 *  until the next connect, which may never come. */
function scheduleSettleCheck(): void {
  if (settleTimer) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    retireCellless();
    void reconcileWithServer();
    if ([...filedAt.values()].some((at) => Date.now() - at < SPAWN_SETTLE_MS)) scheduleSettleCheck();
  }, SPAWN_SETTLE_MS);
}

/** Drop chats this grid holds no cell for. The pane borrows a cell's terminal rather than owning
 *  one, so a tab with no cell sits over an empty pane — which is what a restored filing produces
 *  when the cell has since been closed.
 *
 *  Only ids that have SETTLED, and only once the grid has published something: a chat is filed a
 *  moment before its cell is placed, and "the grid has not said yet" is not "the grid has none". */
function retireCellless(): void {
  const held = gridSessionIds.value;
  if (!held) return;
  const cells = new Set(held);
  const settled = Date.now() - SPAWN_SETTLE_MS;
  [...filed.values()]
    .flatMap((chats) => chats.sessions.map((session) => session.id))
    .filter((id) => !cells.has(id) && (filedAt.get(id) ?? 0) <= settled)
    .forEach(forgetEndedChat);
}

/** Ask which filed chats the server still has, and retire the rest. Silent on failure and on a
 *  malformed answer: the tabs are of running agents, so "we could not check" must leave them
 *  standing rather than close them.
 *
 *  Retires only within the ids the answer says it CONSIDERED, never within the ids we sent. The
 *  route validates and caps what it was given, so the two differ — and treating a capped-off id as
 *  absent would close a live chat's tab (Codex, PR #2002). Whatever it did not consider is simply
 *  left for the next connect. */
async function reconcileWithServer(): Promise<void> {
  const settled = Date.now() - SPAWN_SETTLE_MS;
  const ids = [...new Set([...filed.values()].flatMap((held) => held.sessions.map((session) => session.id)))].filter((id) => (filedAt.get(id) ?? 0) <= settled);
  for (let from = 0; from < ids.length; from += LIVE_QUERY_CHUNK) await askAbout(ids.slice(from, from + LIVE_QUERY_CHUNK));
}

/** How many ids one request carries. The route considers only the first `ACTIVITY_IDS_LIMIT` (200)
 *  it is given, so a single request for everything would leave the rest unasked for as long as the
 *  filing stands (Codex, PR #2002). Comfortably under that, in sequence, so every filed chat is
 *  actually asked about. */
const LIVE_QUERY_CHUNK = 100;

async function askAbout(ids: readonly string[]): Promise<void> {
  try {
    const res = await fetchWithTimeout(`/api/sessions/live?ids=${encodeURIComponent(ids.join(","))}`);
    if (!res.ok) return;
    const body = await jsonBody(res);
    if (!isUnknownArray(body.live) || !isUnknownArray(body.asked)) return;
    const live = new Set(body.live.filter((id): id is string => typeof id === "string"));
    body.asked.filter((id): id is string => typeof id === "string" && !live.has(id)).forEach(forgetEndedChat);
  } catch {
    // best-effort — the next connect asks again
  }
}

/** Forget a session wherever it is filed — it has ended, so the tab names nothing. The terminal
 *  itself is the grid's: the cell tears its own connection down. */
export function forgetEndedChat(id: string): void {
  const holders = [...filed.entries()].filter(([, held]) => held.sessions.some((session) => session.id === id)).map(([key]) => key);
  if (holders.length === 0) return;
  holders.forEach((key) => dropCollectionChat(key, id));
}

/** How many chats are running under collections, across all of them.
 *
 *  The toolbar's Collections button wears this: a session in the pane is invisible from anywhere
 *  else — that is the price of not putting it in the grid — so the door it lives behind is where
 *  its existence has to be legible. */
export function collectionChatCount(): number {
  let total = 0;
  filed.forEach((held) => (total += held.sessions.length));
  return total;
}

/** Stop listening and forget the schedule — there is nothing filed to keep honest. */
function stopWatchingEndings(): void {
  filedAt.clear();
  stopListening?.();
  stopListening = null;
}

/** Test seam: forget everything filed. Not used by the app. */
export function resetCollectionChats(): void {
  filed.clear();
  stopWatchingEndings();
  saveFiled();
}

// A filing restored from storage has had none of this arranged for it — nothing called
// `holdCollectionChat` this time round. Without it a reloaded tab would never be retired: no
// listener for the server's `closed`, and no settle check to notice a cell that is gone.
if (filed.size > 0) {
  listenForEndings();
  scheduleSettleCheck();
}
