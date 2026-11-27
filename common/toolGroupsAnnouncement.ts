// What the server announces once a session's MCP client has connected, and on which channel.
//
// Its own channel rather than the `sessions` one: that channel's consumer admits anything with an `id`
// and feeds it to applyActivity, so a message shaped like this would be read as an activity update.
import { isRecord } from "./isRecord.js";

export const TOOL_GROUPS_CHANNEL = "tool-groups";

// `groups` is absent on the bare "my client is up" announcement, which is sent for EVERY session —
// including an all-tools one, which has no groups to report — so a missing `groups` must never be
// read as an empty list: that would tell a cell that can draw that it cannot. Undefined and `[]`
// are different answers here, which is why this parses rather than defaults.
export interface ToolGroupsAnnouncement {
  sessionId: string;
  groups?: string[] | undefined;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function toolGroupsAnnouncementOf(data: unknown): ToolGroupsAnnouncement | null {
  if (!isRecord(data) || typeof data.sessionId !== "string" || !data.sessionId) return null;
  return isStringArray(data.groups) ? { sessionId: data.sessionId, groups: data.groups } : { sessionId: data.sessionId };
}
