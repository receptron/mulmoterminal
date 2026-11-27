import { onBeforeUnmount } from "vue";
import { TOOL_GROUPS_CHANNEL, toolGroupsAnnouncementOf, type ToolGroupsAnnouncement } from "../../common/toolGroupsAnnouncement";
import { REMOTE_TOOL_GROUPS_CHANNEL, parseRemoteToolGroups } from "../../common/remoteHosts";
import { usePubSub } from "./usePubSub";

/** An announcement and the host whose session it names: null for this machine. */
export interface HostedToolGroupsAnnouncement extends ToolGroupsAnnouncement {
  host: string | null;
}

// Subscribe for as long as the calling component lives.
//
// Three surfaces ask what a session's tools are when they mount — the grid's Canvas button, the GUI
// panel's tool hint, the tools pane — and all three ask BEFORE the agent's MCP client has connected,
// because the browser is handed a session id while the agent is still being spawned. That first
// "nothing" then stood until something happened to remount the pane. This announcement is the one
// signal that says to ask again; each caller decides what re-asking means for it. A remote host's
// arrive through the gateway's relay (#3506), with the host beside them.
export function onToolGroupsAnnounced(handler: (announcement: HostedToolGroupsAnnouncement) => void): void {
  const { subscribe } = usePubSub();
  const offLocal = subscribe(TOOL_GROUPS_CHANNEL, (data) => {
    const announcement = toolGroupsAnnouncementOf(data);
    if (announcement) handler({ ...announcement, host: null });
  });
  const offRemote = subscribe(REMOTE_TOOL_GROUPS_CHANNEL, (data) => {
    const relayed = parseRemoteToolGroups(data);
    if (relayed) handler({ ...relayed.announcement, host: relayed.host });
  });
  onBeforeUnmount(() => {
    offLocal();
    offRemote();
  });
}
