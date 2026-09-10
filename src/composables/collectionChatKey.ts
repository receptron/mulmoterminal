// What a chat started from a collection is filed under (#2001).
//
// Pure, and in its own file, because three places need it and they have nothing else in common: the
// filing itself, the browse composable (which answers "where are we now"), and the specs. Keeping
// it here is what lets the placement seam stay free of the terminal stack.

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
