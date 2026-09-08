import { reactive } from "vue";
import type { SpawnedChatRequest } from "./useSpawnedChat";

// Which chat belongs to which collection (#2001).
//
// The first version tied a session to the OVERLAY: it appeared under whatever was on screen and
// was handed to the grid when the overlay closed. Both halves were wrong in use — the pane stayed
// open after switching to another collection, and going to the grid and back left nothing to come
// back to. A chat started from a collection is ABOUT that collection, so that is what it is filed
// under, and the pane shows whatever the collection you are looking at has.
//
// Module state, not the pane's: it has to outlive the overlay for a session to still be there when
// you come back. The terminal's own socket and scrollback outlive it too — the pane gives its
// terminal a durable slot keyed by the session (`persistKey`), which is what makes returning
// instant rather than a reconnect that redraws.
/** The browse view, as `useCollectionBrowse` reports it. Taken as the shape rather than imported
 *  so this stays a pure function of what it is given. */
export type BrowseViewLike = { mode: "closed" } | { mode: "index"; kind: string } | { mode: "detail"; kind: string; slug: string };

/** What a session is filed under, or null when nothing is open to file it under.
 *
 *  The INDEX is a place too: the "+ Collection" flow starts its chat there, before any collection
 *  exists to belong to. It gets its own key rather than being dropped, so that chat comes back the
 *  same way the others do.
 *
 *  The project is part of the key because the same slug in two projects is two collections — the
 *  distinction the whole `collectionSurface` stack exists to keep. */
export function collectionChatKey(view: BrowseViewLike, projectId: string | null): string | null {
  if (view.mode === "closed") return null;
  const project = projectId ?? "workspace";
  return view.mode === "index" ? `${project}|index:${view.kind}` : `${project}|${view.kind}:${view.slug}`;
}

const sessions = reactive(new Map<string, SpawnedChatRequest>());

/** File a session under a collection, answering whatever it replaces — the caller has to put that
 *  one somewhere rather than let it run on no screen at all. */
export function holdCollectionChat(key: string, req: SpawnedChatRequest): SpawnedChatRequest | null {
  const replaced = sessions.get(key) ?? null;
  sessions.set(key, req);
  return replaced;
}

export function collectionChatFor(key: string | null): SpawnedChatRequest | null {
  return (key && sessions.get(key)) || null;
}

/** Stop showing this collection's session here — it has gone to the grid, or it has exited. */
export function dropCollectionChat(key: string): void {
  sessions.delete(key);
}

/** Test seam: forget everything filed. Not used by the app. */
export function resetCollectionChats(): void {
  sessions.clear();
}
