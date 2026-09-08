import type { SpawnedChatRequest } from "./useSpawnedChat";

// Where a chat started from a collection appears while the Collections overlay is open (#2001).
//
// Without this it appears as a GRID CELL, and `placeSpawnedChat` then brings the grid on screen —
// so pressing a card's action closes the collection you were reading. The overlay claims the
// placement instead and shows the session in a pane under the collection, which is what lets the
// two be used together.
//
// A CLAIM, not a queue, and deliberately not the seam GridView uses: that one holds a single
// handler, so registering here would detach the grid's and leave it detached (its own register
// runs on activate). This sits in front of it — nothing registered means the grid path runs, byte
// for byte as before.
//
// The pane is a temporary HOLDER, not an owner: a session can only have one live socket (a new
// attach supersedes the old one, `server/session/pty-connection.ts`), so the pane hands the
// request on to `placeSpawnedChat` when it lets go. Every session still ends up a grid cell; the
// pane only decides WHEN.
let claim: ((req: SpawnedChatRequest) => boolean) | null = null;

/** Claim placement while the pane can show it. The returned function releases the claim — call it
 *  on unmount, and only it clears the claim, so a stale release cannot detach a newer one. */
export function claimCollectionChat(take: (req: SpawnedChatRequest) => boolean): () => void {
  claim = take;
  return () => {
    if (claim === take) claim = null;
  };
}

/** True when the pane took the session — the caller must then NOT place it in the grid. False
 *  whenever no pane is open, which is every path that existed before this. */
export function offerCollectionChat(req: SpawnedChatRequest): boolean {
  return claim?.(req) ?? false;
}
