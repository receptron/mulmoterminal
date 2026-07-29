import { computed } from "vue";
import { isBackground, isUnread, matchesFilter, type Session, type Filter } from "./useSessions";
import type { TerminalAgent } from "../../common/sessionAgent";

// The event contract App.vue wires to both session-list layouts (the vertical
// Sidebar and the horizontal SessionTabBar); v-model:filter drives update:filter.
export type SessionListEmits = {
  (e: "select", id: string, agent: TerminalAgent): void;
  (e: "new" | "new-codex" | "new-antigravity" | "toggle-layout" | "refresh"): void;
  (e: "update:filter", f: Filter): void;
};

// What App.vue hands a session-list layout. The event half of this contract has been named
// since both layouts were written; the props half was left inline in each of them, which is
// how the same three lines ended up in both components (#646 B2).
export interface SessionListProps {
  sessions: Session[];
  activeId: string | null;
  filter: Filter;
}

// The chips' counts and the filter-applied list, shared by both layouts.
// The horizontal bar caps `filteredSessions` to its most-recent tabs itself.
// `isUnread` rides along because both layouts also mark rows with it — one import
// gets a layout everything the session-list contract offers.
export function useSessionFilter(props: Pick<SessionListProps, "sessions" | "filter">) {
  const unreadCount = computed(() => props.sessions.filter(isUnread).length);
  const backgroundCount = computed(() => props.sessions.filter(isBackground).length);
  const filteredSessions = computed(() => props.sessions.filter((s) => matchesFilter(s, props.filter)));
  return { unreadCount, backgroundCount, filteredSessions, isUnread };
}

// What to say when the server returned sessions but the chip matched none of them. The
// default chip can land here too: a project whose only sessions are background workers has
// rows to list and no chats, which "No sessions yet" would report as an empty project.
export function sessionListEmptyMessage(filter: Filter): string {
  if (filter === "unread") return "No unread sessions";
  if (filter === "background") return "No background sessions";
  return "No chat sessions";
}
