import { computed } from "vue";
import { isUnread, type Session, type Filter } from "./useSessions";

// The event contract App.vue wires to both session-list layouts (the vertical
// Sidebar and the horizontal SessionTabBar); v-model:filter drives update:filter.
export type SessionListEmits = {
  (e: "select", id: string, agent: "claude" | "codex"): void;
  (e: "new" | "new-codex" | "toggle-layout" | "refresh"): void;
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

// The Unread chip's count and the filter-applied list, shared by both layouts.
// The horizontal bar caps `filteredSessions` to its most-recent tabs itself.
export function useSessionFilter(props: Pick<SessionListProps, "sessions" | "filter">) {
  const unreadCount = computed(() => props.sessions.filter(isUnread).length);
  const filteredSessions = computed(() => (props.filter === "unread" ? props.sessions.filter(isUnread) : props.sessions));
  return { unreadCount, filteredSessions };
}
