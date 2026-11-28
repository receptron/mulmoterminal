// Whether the Library may resume a conversation, and as what (#3329). The same rule the command
// palette applies (paletteResumes.ts): a session held by another client, or already open in this
// grid, is not taken from it. Pure.
import type { ResumableList, SessionOccupancyAnswer } from "../../composables/useDirLists";
import { isBusyResume } from "../../composables/paletteResumes";
import type { LibraryConversation } from "../../../common/library";

export type LibraryResume = { kind: "open"; id: string; cwd: string; account: string | null } | { kind: "busy" } | { kind: "no-cwd" } | { kind: "unchecked" };

/** Whether the list leaves the question open: it was read and does not name the conversation, so
 *  only the single-id occupancy answer can say who holds it (the list is capped at the newest N). */
export const needsOccupancy = (conversation: LibraryConversation, list: ResumableList | null): boolean =>
  conversation.cwd !== null && list !== null && !list.sessions.some((session) => session.id === conversation.id);

/** `list` is the conversation's directory's resumable list, and `occupancy` the single-id answer
 *  asked for when `needsOccupancy`; either is null when it could not be read. Nothing unread is
 *  taken as free: an unread answer proves nothing about who holds the session. */
export function libraryResume(
  conversation: LibraryConversation,
  list: ResumableList | null,
  openSessionIds: readonly string[],
  occupancy: SessionOccupancyAnswer | null = null,
): LibraryResume {
  if (conversation.cwd === null) return { kind: "no-cwd" };
  if (list === null) return { kind: "unchecked" };
  const row = list.sessions.find((session) => session.id === conversation.id);
  if (row !== undefined) {
    if (isBusyResume(row, openSessionIds)) return { kind: "busy" };
    return { kind: "open", id: row.runningKey ?? row.id, cwd: list.cwd ?? conversation.cwd, account: row.account ?? null };
  }
  if (openSessionIds.includes(conversation.id)) return { kind: "busy" };
  if (occupancy === null || occupancy.id !== conversation.id) return { kind: "unchecked" };
  if (isBusyResume(occupancy, openSessionIds)) return { kind: "busy" };
  return { kind: "open", id: occupancy.runningKey ?? conversation.id, cwd: conversation.cwd, account: null };
}
