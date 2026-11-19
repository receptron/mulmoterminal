// Whether the Library may resume a conversation, and as what (#3329). The same rule the command
// palette applies (paletteResumes.ts): a session held by another client, or already open in this
// grid, is not taken from it. Pure.
import type { ResumableList } from "../../composables/useDirLists";
import { isBusyResume } from "../../composables/paletteResumes";
import type { LibraryConversation } from "../../../common/library";

export type LibraryResume = { kind: "open"; id: string; cwd: string; account: string | null } | { kind: "busy" } | { kind: "no-cwd" } | { kind: "unchecked" };

/** `list` is the conversation's directory's resumable list, or null when it could not be read. An
 *  unread list proves nothing about who holds the session, so nothing is resumed on it; a list that
 *  was read but does not name the conversation (an older one) resumes it by its own id, which
 *  `claude --resume` accepts for any session. */
export function libraryResume(conversation: LibraryConversation, list: ResumableList | null, openSessionIds: readonly string[]): LibraryResume {
  if (conversation.cwd === null) return { kind: "no-cwd" };
  if (list === null) return { kind: "unchecked" };
  const row = list.sessions.find((session) => session.id === conversation.id);
  if (row === undefined)
    return openSessionIds.includes(conversation.id) ? { kind: "busy" } : { kind: "open", id: conversation.id, cwd: conversation.cwd, account: null };
  if (isBusyResume(row, openSessionIds)) return { kind: "busy" };
  return { kind: "open", id: row.runningKey ?? row.id, cwd: list.cwd ?? conversation.cwd, account: row.account ?? null };
}
