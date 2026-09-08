import { reactive } from "vue";
import type { SpawnedChatRequest } from "./useSpawnedChat";
import { usePubSub } from "./usePubSub";
import { parseSessionActivityPayload } from "./sessionActivity";
import { release } from "./useTerminalConnections";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

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
// Module state, not the pane's: it has to outlive the overlay for a session to still be there when
// you come back. The terminal's own socket and scrollback outlive it too — the pane gives each
// terminal a durable slot keyed by the session (`persistKey`), which is what makes returning, and
// switching tabs, instant rather than a reconnect that redraws.

/** The browse view, as `useCollectionBrowse` reports it. Taken as the shape rather than imported so
 *  this stays a pure function of what it is given. */
export type BrowseViewLike = { mode: "closed" } | { mode: "index"; kind: string } | { mode: "detail"; kind: string; slug: string };

/** What a collection's chats are filed under, or null when nothing is open to file them under.
 *
 *  The INDEX is a place too: the "+ Collection" flow starts its chat there, before any collection
 *  exists to belong to. It gets its own key rather than being dropped, so those chats come back the
 *  same way the others do.
 *
 *  The project is part of the key because the same slug in two projects is two collections — the
 *  distinction the whole `collectionSurface` stack exists to keep. */
export function collectionChatKey(view: BrowseViewLike, projectId: string | null): string | null {
  if (view.mode === "closed") return null;
  const project = projectId ?? "workspace";
  return view.mode === "index" ? `${project}|index:${view.kind}` : `${project}|${view.kind}:${view.slug}`;
}

/** One collection's chats, in the order they were started, and which of them the pane is showing. */
export interface CollectionChats {
  sessions: SpawnedChatRequest[];
  activeId: string | null;
}

const NONE: CollectionChats = { sessions: [], activeId: null };
const filed = reactive(new Map<string, CollectionChats>());

export function collectionChatsFor(key: string | null): CollectionChats {
  return (key && filed.get(key)) || NONE;
}

/** File a new chat under a collection and show it. Appended rather than replacing: the one already
 *  running is still running, and taking its screen away to make room is what the tabs are for. */
export function holdCollectionChat(key: string, req: SpawnedChatRequest): void {
  listenForEndings();
  const held = filed.get(key) ?? { sessions: [], activeId: null };
  if (!held.sessions.some((session) => session.id === req.id)) held.sessions.push(req);
  held.activeId = req.id;
  filed.set(key, held);
}

/** Show one of the collection's chats. Ignores an id it does not hold, so a stale click cannot
 *  leave the pane pointing at nothing. */
export function activateCollectionChat(key: string, id: string): void {
  const held = filed.get(key);
  if (held?.sessions.some((session) => session.id === id)) held.activeId = id;
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
  if (held.sessions.length === 0) {
    filed.delete(key);
    return;
  }
  const next = held.sessions[index - 1] ?? held.sessions[0];
  if (held.activeId === id && next) held.activeId = next.id;
}

/** The durable terminal slot a filed chat runs in. Named for the session rather than for a
 *  position, so the same chat shown again — another tab, another visit to the collection — comes
 *  back to the terminal it left rather than reconnecting and redrawing. */
export const collectionChatSlotKey = (id: string): string => `collection-chat-${id}`;

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
  const { subscribe, onReconnect } = usePubSub();
  const off = subscribe("sessions", (data) => {
    const update = parseSessionActivityPayload(data);
    if (update && "closed" in update) forgetEndedChat(update.id);
  });
  // A push that happened while the socket was down is not replayed when it comes back — pub/sub
  // restores room membership, not the events missed (Codex, PR #2002). So a reconnect asks the
  // server outright which of these are still running. The same shape `useSessions` and
  // `useGridActivity` use for their own re-syncs, for the same reason.
  const offReconnect = onReconnect(() => void reconcileWithServer());
  stopListening = () => {
    off();
    offReconnect();
  };
}

/** Ask which filed chats the server still has, and retire the rest. Silent on failure and on a
 *  malformed answer: the tabs are of running agents, so "we could not check" must leave them
 *  standing rather than close them. */
async function reconcileWithServer(): Promise<void> {
  const ids = [...new Set([...filed.values()].flatMap((held) => held.sessions.map((session) => session.id)))];
  if (ids.length === 0) return;
  try {
    const res = await fetchWithTimeout(`/api/sessions/live?ids=${encodeURIComponent(ids.join(","))}`);
    if (!res.ok) return;
    const body = await jsonBody(res);
    if (!isUnknownArray(body.live)) return;
    const live = new Set(body.live.filter((id): id is string => typeof id === "string"));
    ids.filter((id) => !live.has(id)).forEach(forgetEndedChat);
  } catch {
    // best-effort — the next reconnect asks again
  }
}

/** Forget a session wherever it is filed — it has ended, so there is nothing to move and nothing
 *  to come back to. Its terminal slot goes with it. */
export function forgetEndedChat(id: string): void {
  const holders = [...filed.entries()].filter(([, held]) => held.sessions.some((session) => session.id === id)).map(([key]) => key);
  if (holders.length === 0) return;
  holders.forEach((key) => dropCollectionChat(key, id));
  release(collectionChatSlotKey(id));
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

/** Test seam: forget everything filed. Not used by the app. */
export function resetCollectionChats(): void {
  filed.clear();
  stopListening?.();
  stopListening = null;
}
