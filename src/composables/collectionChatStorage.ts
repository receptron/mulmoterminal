import { asTerminalAgent } from "../../common/sessionAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import type { SpawnedChatRequest } from "./useSpawnedChat";
import type { CollectionChats } from "./collectionChatSessions";

// Which chats belong to which collection, ACROSS A RELOAD (#2001).
//
// The chats themselves survive one already — they are grid cells, and the grid's layout is
// persisted — but the filing was module state, so after a reload the collection knew nothing about
// them: the pane came back empty while the same agents were still running two clicks away.
//
// Browser state, beside the grid's own (`grid_v2`): what it names are that browser's cells, so a
// per-server copy would list sessions this grid has never heard of.
//
// Pure, and its own file, so the shape can be read back and rejected without touching the live
// filing — everything here is untrusted JSON from a store the user can edit.

export const COLLECTION_CHATS_KEY = "mt-collection-chats";

// The id is the only field that can invalidate a chat: without it there is nothing to show. The
// agent goes through the same coercion a remembered agent gets everywhere else (unknown reads as
// claude), and `draft` only decides a label.
const chatOf = (value: unknown): SpawnedChatRequest | null =>
  isRecord(value) && typeof value.id === "string" && value.id ? { id: value.id, agent: asTerminalAgent(value.agent), draft: value.draft === true } : null;

/** What was stored, with anything malformed dropped. A collection with no readable chat left is
 *  dropped too — an empty entry is what `dropCollectionChat` deletes, so restoring one would put
 *  back a state the app never keeps. */
export function parseFiledChats(raw: string | null): Map<string, CollectionChats> {
  const filed = new Map<string, CollectionChats>();
  if (!raw) return filed;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return filed;
    for (const [key, value] of Object.entries(data)) {
      if (!isRecord(value) || !isUnknownArray(value.sessions)) continue;
      const sessions = value.sessions.map(chatOf).filter((chat): chat is SpawnedChatRequest => chat !== null);
      const first = sessions[0];
      if (!first) continue;
      // An `activeId` naming nothing would leave the pane pointing at a tab that is not there.
      const activeId = typeof value.activeId === "string" && sessions.some((chat) => chat.id === value.activeId) ? value.activeId : first.id;
      filed.set(key, { sessions, activeId });
    }
  } catch {
    // unreadable — start empty rather than losing the app to a bad string
  }
  return filed;
}

export function serializeFiledChats(filed: ReadonlyMap<string, CollectionChats>): string {
  const out: Record<string, { sessions: { id: string; agent: string; draft: boolean }[]; activeId: string | null }> = {};
  filed.forEach((held, key) => {
    out[key] = { sessions: held.sessions.map(({ id, agent, draft }) => ({ id, agent, draft })), activeId: held.activeId };
  });
  return JSON.stringify(out);
}
